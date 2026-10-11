/**
 * cookie / session / ด่านตรวจสิทธิ์
 *
 * แยกจาก routes เพราะทั้ง route auth (ตอน login) และด่านตรวจ (ทุก request หลัง login)
 * ใช้ตรรกะชุดเดียวกัน — ถ้าปล่อยไว้ใน server.ts จะแตะไม่ได้เลยโดยไม่กระทบส่วนอื่น
 */
import type { Request, Response, NextFunction } from "express";
import { config } from "../../config.js";
import {
  destroySession,
  resolveSession,
  SESSION_TTL_MS,
  type SessionMeta,
} from "../../auth/session.js";
import type { AccessResolver } from "../../auth/access.js";

/*
 * __Host- prefix = เบราว์เซอร์บังคับเองว่า cookie นี้ต้อง Secure + Path=/ + ไม่มี Domain
 * (ขโมย/ปลูก cookie ข้าม subdomain ไม่ได้) — ใช้ได้เพราะทางเข้าจริงคือ HTTPS ผ่าน
 * Cloudflare และ COOKIE_SECURE=1 อยู่แล้ว · การเปลี่ยนชื่อทำให้ทุกคน login ใหม่ 1 ครั้ง
 */
export const COOKIE_NAME = "__Host-sid";

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
 * session เก็บแค่ Discord user ID — สิทธิ์ (admin/mod) ถามยศจาก Discord ใหม่ทุก request
 * ถอดยศ/ออกจากเซิร์ฟเมื่อไหร่ หลุดทันทีใน request ถัดไป ไม่ต้องรอ session หมดอายุ
 * (อ่านจาก cache ของบอท ไม่ได้ยิง Discord ทุกครั้ง — ดู access.ts)
 */
export function requireAuth(access: AccessResolver) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cookies = parseCookies(req.headers.cookie);
    const cookie = cookies[COOKIE_NAME];
    const session = resolveSession(cookie, metaOf(req));
    const who = session ? await access(session.username).catch(() => null) : null;

    if (!session || !who) {
      // มี session แต่ไม่มีสิทธิ์แล้ว (ถอดยศ) — ทิ้ง session เลย ไม่ต้องเก็บไว้ให้ลองซ้ำ
      if (session) destroySession(cookie);
      if (req.path.startsWith("/api")) {
        res.status(401).json({ error: "unauthorized" });
      } else {
        res.redirect(session ? "/login?error=norole" : "/login");
      }
      return;
    }

    // session ต่ออายุแล้ว → ต่ออายุ cookie ตามด้วย
    // ไม่งั้นฝั่ง server ยังจำได้อยู่ แต่เบราว์เซอร์ทิ้ง cookie ไปตามกำหนดเดิม
    // ผลคือผู้ใช้ถูกเด้งออกทั้งที่ session ยังไม่หมดอายุ
    if (session.refreshed && cookie) {
      res.cookie(COOKIE_NAME, cookie, {
        ...cookieOptions(),
        maxAge: SESSION_TTL_MS,
      });
    }

    res.locals.userId = session.username; // คอลัมน์ username ของ sessions เก็บ Discord user ID
    res.locals.username = who.name; // ชื่อ Discord — ใช้ลงชื่อใน log ว่าใครกด
    res.locals.sessionId = session.id;
    res.locals.role = who.role;
    next();
  };
}

/**
 * ด่านเพิ่มเติมสำหรับ route ที่มีแต่ admin ทำได้ (ตั้งค่าบอท ฯลฯ)
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

/**
 * ด่านสำหรับของที่ "เจ้าของเครื่องคนเดียวเห็น" — แม้แต่ admin คนอื่นก็ไม่เห็น
 *
 * ทำไมไม่ใช้ role admin: ยศให้ใครก็ได้ และมีแอดมินหลายคน
 * ของบางอย่าง (เช่นแผงคุมเซิร์ฟเวอร์เกม ซึ่งสั่งรันโปรเซสบนเครื่องได้)
 * ควรผูกกับบัญชีเดียวที่ระบุไว้ตรง ๆ ไม่ใช่ผูกกับตำแหน่งที่โยกกันได้
 *
 * ตั้ง Discord user ID ของเจ้าของผ่าน DASHBOARD_OWNER ใน .env — ไม่ตั้ง = ปิดฟีเจอร์ทั้งหมด
 * (ปลอดภัยกว่าเผลอเปิดให้ทุกคนเวลาลืมตั้ง) · เทียบกับ ID เท่านั้น ชื่อ Discord เปลี่ยนได้
 */
export function isOwner(userId: unknown): boolean {
  const owner = (process.env.DASHBOARD_OWNER ?? "").trim();
  return owner.length > 0 && userId === owner;
}

/**
 * ส่วนตั้งค่าระบบ + สถานะเครื่อง Pi: mod เห็นปกติ, admin คนอื่นไม่เห็น, เจ้าของเห็นทุกอย่าง
 * (Flick ไม่อยากให้ admin ของเซิร์ฟมาแตะการตั้งค่า — admin ยังใช้เครื่องมือดูแลสมาชิกได้ตามเดิม)
 */
export function seesSystem(role: unknown, userId: unknown): boolean {
  return role !== "admin" || isOwner(userId);
}

export function requireSystemView(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!seesSystem(res.locals.role, res.locals.userId)) {
    res.status(403).json({ error: "forbidden", message: "ส่วนนี้ไม่เปิดให้ admin" });
    return;
  }
  next();
}

export function requireOwner(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isOwner(res.locals.userId)) {
    // 404 ไม่ใช่ 403 — คนอื่นไม่ควรรู้ด้วยซ้ำว่ามี endpoint นี้อยู่
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
