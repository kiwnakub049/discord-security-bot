/**
 * ด่านความปลอดภัยชั้นนอกสุด — security headers + กัน CSRF
 * แยกออกมาจาก server.ts เพื่อให้เห็นชัดว่ากติกาความปลอดภัยทั้งหมดอยู่ที่ไฟล์เดียว
 */
import type { Request, Response, NextFunction } from "express";
import { config } from "../../config.js";

/**
 * หน้าเว็บถูก build เป็นไฟล์ .js/.css แยกแล้ว (Vite) ไม่มี inline <script> อีก
 * เลยตัด 'unsafe-inline' ของ script-src ออกได้ — XSS ที่ฉีด <script> ลงหน้าจะไม่ทำงาน
 *
 * style-src ยังต้องมี 'unsafe-inline' เพราะ React ใส่ style="width:42%" กับแถบความคืบหน้า
 * ซึ่ง CSP นับ style attribute รวมกับ inline <style>
 */
const CSP = [
  "default-src 'self'",
  // รูปโปรไฟล์คนใน log/รายชื่อมาจาก CDN ของ Discord (ดู /api/avatar/:id) — เปิดแค่โดเมนเดียวนี้
  // blob: = พรีวิวรูปในแชททีมก่อนกดส่ง (URL.createObjectURL ของไฟล์ในเครื่องตัวเอง)
  "img-src 'self' data: blob: https://cdn.discordapp.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'", // ไม่มี <object>/<embed> ในเว็บนี้ ปิดไปเลย
  "base-uri 'none'", // กันคนฉีด <base href> เปลี่ยนปลายทางของ path สัมพัทธ์ทั้งหน้า
  "form-action 'self'", // ฟอร์ม login ส่งได้เฉพาะกลับมาที่เว็บตัวเอง
  "frame-ancestors 'none'", // เวอร์ชันใหม่ของ X-Frame-Options
].join("; ");

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // same-origin ไม่ใช่ no-referrer — no-referrer ทำให้เบราว์เซอร์ส่ง "Origin: null"
  // กับ form POST ของหน้าตัวเอง (ตามสเปค Fetch) จน CSRF check ด้านล่างบล็อก login ทั้งเว็บ
  // same-origin: ส่ง Origin/Referer ปกติภายในเว็บตัวเอง แต่ไม่รั่วไปเว็บอื่นเหมือนกัน
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
  next();
}

/**
 * ป้องกัน CSRF (ชั้นที่สองเสริม SameSite=lax)
 * ทุก request ที่เปลี่ยนสถานะ (POST/PUT/PATCH/DELETE) ต้องมาจาก origin เดียวกัน
 * เช็คจาก Origin ก่อน ถ้าไม่มีค่อยดู Referer — ถ้า host ไม่ตรง = ปฏิเสธ
 *
 * cross-site fetch ของเบราว์เซอร์จะแนบ Origin เสมอ จึงบล็อกได้
 * เครื่องมือที่ไม่ใช่เบราว์เซอร์ (curl) ไม่มี header ทั้งคู่ → ปล่อยผ่าน เพราะ CSRF
 * ต้องอาศัยเบราว์เซอร์แนบ cookie ให้เองอยู่แล้ว
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const source = req.headers.origin || req.headers.referer;
  if (source) {
    let sourceHost: string | null = null;
    try {
      sourceHost = new URL(source).host;
    } catch {
      /* header เพี้ยน — ถือว่าไม่ตรง */
    }
    if (sourceHost !== req.headers.host) {
      // log ไว้วินิจฉัย — ถ้าผู้ใช้จริงโดนบล็อกจะได้เห็นว่า header อะไรเพี้ยน
      console.warn(
        `🛑 CSRF block ${req.method} ${req.path} — origin=${req.headers.origin ?? "-"} referer=${req.headers.referer ?? "-"} host=${req.headers.host}`,
      );
      res.status(403).json({ error: "cross-site request blocked" });
      return;
    }
  }
  next();
}
