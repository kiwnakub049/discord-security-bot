/**
 * cookie / session / การกัน brute-force หน้า login
 *
 * แยกจาก routes เพราะทั้ง route auth (ตอน login) และด่านตรวจ (ทุก request หลัง login)
 * ใช้ตรรกะชุดเดียวกัน — ถ้าปล่อยไว้ใน server.ts จะแตะไม่ได้เลยโดยไม่กระทบส่วนอื่น
 */
import type { Request, Response, NextFunction } from "express";
import { config } from "../../config.js";
import {
  resolveSession,
  SESSION_TTL_MS,
  type SessionMeta,
} from "../../auth/session.js";
import { getRole, userExists } from "../../auth/users.js";

export const COOKIE_NAME = "sid";

export function cookieOptions() {
  return {
    httpOnly: true, // JS ฝั่ง browser อ่าน cookie นี้ไม่ได้ (กัน XSS ขโมย)
    secure: config.web.cookieSecure, // ส่งเฉพาะผ่าน HTTPS (เปิดใน production)
    sameSite: "lax" as const, // กัน CSRF ข้ามเว็บ
    path: "/",
  };
}

/** อ่าน cookie จาก header แบบไม่ต้องลง cookie-parser */
export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** ข้อมูลเครื่องที่ยิงเข้ามา — เก็บไว้โชว์ในหน้าจัดการอุปกรณ์ */
export function metaOf(req: Request): SessionMeta {
  return {
    userAgent: String(req.headers["user-agent"] ?? ""),
    ip: req.ip ?? "",
  };
}

/**
 * ด่านตรวจ: ทุกอย่างหลังจากนี้ต้อง login
 * เส้นทาง /api ตอบ 401 (ให้ฝั่งหน้าเว็บรู้ว่าต้องพาไป login เอง)
 * เส้นทางอื่นเด้งไปหน้า login ตรง ๆ
 *
 * เช็ค userExists ทุกครั้ง → ลบ user เมื่อไหร่ session เดิมหลุดทันที
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const cookies = parseCookies(req.headers.cookie);
  const cookie = cookies[COOKIE_NAME];
  const session = resolveSession(cookie, metaOf(req));

  if (!session || !userExists(session.username)) {
    if (req.path.startsWith("/api")) {
      res.status(401).json({ error: "unauthorized" });
    } else {
      res.redirect("/login");
    }
    return;
  }

  // session ต่ออายุแล้ว → ต่ออายุ cookie ตามด้วย
  // ไม่งั้นฝั่ง server ยังจำได้อีก 30 วัน แต่เบราว์เซอร์ทิ้ง cookie ไปตามกำหนดเดิม
  // ผลคือผู้ใช้ถูกเด้งออกทั้งที่ session ยังไม่หมดอายุ
  if (session.refreshed && cookie) {
    res.cookie(COOKIE_NAME, cookie, {
      ...cookieOptions(),
      maxAge: SESSION_TTL_MS,
    });
  }

  res.locals.username = session.username;
  res.locals.sessionId = session.id;
  res.locals.role = getRole(session.username) ?? "mod";
  next();
}

/**
 * ด่านเพิ่มเติมสำหรับ route ที่มีแต่ admin ทำได้ (จัดการบัญชี, ตั้งค่าบอท)
 * ต้องวางต่อจาก requireAuth เสมอ (อาศัย res.locals.role ที่ requireAuth ตั้งไว้)
 * mod ที่พยายามเรียกตรง ๆ จะได้ 403 แม้ปุ่มบนหน้าเว็บจะถูกซ่อนไปแล้วก็ตาม
 */
export function requireAdmin(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.locals.role !== "admin") {
    res.status(403).json({ error: "forbidden", message: "ต้องเป็น admin" });
    return;
  }
  next();
}

// ---- กัน brute-force หน้า login (นับต่อ IP) ----
// inFlight = จำนวน attempt ที่กำลังคำนวณ scrypt อยู่ (นับ synchronous ตอนเข้า handler)
// จำเป็นเพราะ verifyPassword เป็น async: ถ้านับ fail หลัง await เท่านั้น การยิงพร้อมกันหลาย request
// จะผ่านด่านเช็คก่อนตัวนับขยับ (TOCTOU) — นับ inFlight ทันทีเลยปิดช่องนี้
const loginTracker = new Map<
  string,
  { fails: number; inFlight: number; lockedUntil: number; lastAttempt: number }
>();

/** คืนจำนวนนาทีที่ยังถูกล็อก (0 = ไม่ถูกล็อก) */
export function loginLockedMinutes(ip: string): number {
  const rec = loginTracker.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    return Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
  }
  return 0;
}

/**
 * จองสิทธิ์ลอง 1 ครั้ง (เรียก synchronous ตอนเข้า handler ก่อน await ใด ๆ)
 * คืน "locked" ถ้าล็อกอยู่/เต็มโควตาแล้ว (ต้องปฏิเสธ), "ok" ถ้าลองต่อได้
 * นับ fails + inFlight รวมกัน → burst พร้อมกันเกินโควตาก็โดนกันทันที
 */
export function beginLoginAttempt(ip: string): "ok" | "locked" {
  const now = Date.now();
  const rec = loginTracker.get(ip) ?? {
    fails: 0,
    inFlight: 0,
    lockedUntil: 0,
    lastAttempt: 0,
  };
  rec.lastAttempt = now;
  if (rec.lockedUntil > now) {
    loginTracker.set(ip, rec);
    return "locked";
  }
  // ผ่านช่วงล็อกมาแล้ว (lockedUntil หมดอายุ) → เริ่มนับใหม่หมด
  // ไม่งั้น fails เก่ายังค้างที่ loginMaxAttempts ทำให้ attempt แรกหลังปลดล็อก
  // เข้าเงื่อนไข "เต็มโควตา" ด้านล่างแล้วต่ออายุล็อกทันที = ล็อกถาวรจนกว่าจะรีสตาร์ท
  if (rec.lockedUntil > 0) {
    rec.fails = 0;
    rec.lockedUntil = 0;
  }
  if (rec.fails + rec.inFlight >= config.web.loginMaxAttempts) {
    rec.lockedUntil = now + config.web.loginLockMs;
    loginTracker.set(ip, rec);
    return "locked";
  }
  rec.inFlight += 1;
  loginTracker.set(ip, rec);
  return "ok";
}

/** ปิด attempt ที่จองไว้ — คืน true ถ้าการพลาดครั้งนี้ทำให้เพิ่งถูกล็อก */
export function endLoginAttempt(ip: string, success: boolean): boolean {
  const rec = loginTracker.get(ip);
  if (!rec) return false;
  rec.inFlight = Math.max(0, rec.inFlight - 1);
  if (success) {
    loginTracker.delete(ip); // สำเร็จ → ล้างตัวนับทั้งหมด
    return false;
  }
  rec.fails += 1;
  let justLocked = false;
  if (
    rec.fails >= config.web.loginMaxAttempts &&
    rec.lockedUntil <= Date.now()
  ) {
    rec.lockedUntil = Date.now() + config.web.loginLockMs;
    justLocked = true;
  }
  loginTracker.set(ip, rec);
  return justLocked;
}

// เคลียร์ rate-limit record ที่หมดอายุทุก 1 ชม. กัน memory โต
// ลบทิ้งเมื่อ: ไม่มี attempt ค้าง (inFlight 0), ไม่ได้ล็อกอยู่ (lockedUntil ผ่านแล้ว),
// และเงียบมานานเกินหน้าต่างล็อก 1 รอบ — ครอบคลุมทั้ง record ที่ fails=0 และที่ fails
// ค้าง 1-4 แล้วถูกทิ้งกลางคัน (เดิมเช็ค fails===0 อย่างเดียว record พวกนี้เลยค้างถาวร)
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, r] of loginTracker) {
      if (
        r.inFlight === 0 &&
        r.lockedUntil < now &&
        now - r.lastAttempt > config.web.loginLockMs
      )
        loginTracker.delete(ip);
    }
  },
  60 * 60 * 1000,
).unref();
