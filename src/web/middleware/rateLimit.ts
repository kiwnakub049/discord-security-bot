/**
 * จำกัดจำนวน request ต่อ IP (fixed window) — กัน botnet ยิงถล่ม endpoint หนัก ๆ
 *
 * ทำเองแทนการลง express-rate-limit ด้วยเหตุผลเดียวกับ middleware อื่นใน repo นี้:
 * ตรรกะสั้นพอที่การอ่านโค้ด 60 บรรทัดตรง ๆ ปลอดภัยกว่าการไล่ config ของ dependency
 *
 * คีย์ด้วย req.ip ซึ่งเชื่อถือได้บน topology ปัจจุบัน (bind 127.0.0.1 + trust proxy = 1):
 * ค่าขวาสุดของ X-Forwarded-For ถูกเติมโดย cloudflared หรือ tailscale serve เท่านั้น
 * ค่าที่ client ปลอมแนบมาเองอยู่ซ้ายกว่าและถูกตัดทิ้ง
 * จงใจไม่ใช้ CF-Connecting-IP — ทางเข้า tailnet ไม่มี header นี้ และ client ปลอมแนบเองได้
 *
 * ตัวนับอยู่ในหน่วยความจำ (restart แล้วรีเซ็ต) — ยอมรับได้เพราะเป้าหมายคือกันการยิงรัว
 * ไม่ใช่บัญชีความผิดถาวร ส่วนการล็อก login จริงจังอยู่ที่ loginTracker ใน auth.ts
 */
import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * สร้าง middleware จำกัด `max` ครั้งต่อ `windowMs` ต่อ IP สำหรับกลุ่มเส้นทางหนึ่ง ๆ
 * `name` แยก quota แต่ละกลุ่มออกจากกัน (global กับ export ไม่กินโควตากันเอง)
 * `onTrip` ถูกเรียกครั้งเดียวต่อ window ต่อ IP ตอนเกินโควตาครั้งแรก — ใช้ส่งแจ้งเตือน
 * โดยไม่เปิดช่องให้ผู้โจมตียิงรัวเพื่อสแปมห้อง log
 */
export function rateLimit(
  name: string,
  max: number,
  windowMs: number,
  onTrip?: (ip: string, req: Request) => void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? "?";
    const key = `${name}:${ip}`;
    const now = Date.now();
    let rec = buckets.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      buckets.set(key, rec);
    }
    rec.count += 1;
    if (rec.count > max) {
      // Retry-After บอกฝั่ง client ที่สุภาพว่าควรรอกี่วินาที (บอทไม่สนใจก็โดน 429 ต่อไป)
      res.setHeader("Retry-After", String(Math.ceil((rec.resetAt - now) / 1000)));
      res.status(429).json({ error: "too many requests" });
      if (rec.count === max + 1) onTrip?.(ip, req);
      return;
    }
    next();
  };
}

// เคลียร์ bucket ที่หมด window แล้วทุก 10 นาที กัน Map โตไม่จำกัดตอนโดนสแกนจาก IP เยอะ ๆ
setInterval(
  () => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  },
  10 * 60 * 1000,
).unref();

/** สำหรับ test — ล้างตัวนับทั้งหมดให้แต่ละ test เริ่มจากศูนย์ */
export function resetRateLimits(): void {
  buckets.clear();
}
