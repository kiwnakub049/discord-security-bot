/** อุปกรณ์ที่บัญชีนี้ยัง login ค้างอยู่ — ดูรายชื่อและเตะออก */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from "../../auth/session.js";
import { logEvent } from "../../utils/logger.js";

/**
 * แปลง User-Agent เป็นชื่อที่คนอ่านออก
 *
 * ไม่ได้ลงไลบรารีแยก UA เพราะที่ต้องการคือแค่ "เครื่องไหน" พอให้เจ้าของจำได้ว่า
 * อันไหนคือมือถือตัวเอง อันไหนไม่ใช่ของเรา ความละเอียดระดับเลขเวอร์ชันไม่ได้ช่วยตัดสินใจ
 *
 * ลำดับการเช็คสำคัญ — Edge/Chrome ใส่คำว่า "Safari" ใน UA ด้วย
 * ถ้าเช็ค Safari ก่อนจะกลายเป็น Safari ทั้งหมด
 */
export function describeDevice(ua: string): { device: string; browser: string } {
  const device = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : "ไม่ทราบ";

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : /curl|wget|python|node/i.test(ua)
              ? "เครื่องมือบรรทัดคำสั่ง"
              : "ไม่ทราบ";

  return { device, browser };
}

export function sessionRoutes(client?: Client): Router {
  const r = Router();

  r.get("/api/sessions", (_req: Request, res: Response) => {
    const userId = String(res.locals.userId);
    const current = String(res.locals.sessionId);
    res.json(
      listSessions(userId).map((s) => ({
        // ส่ง id ไปให้หน้าเว็บใช้สั่งเตะได้ — เป็น hash อยู่แล้ว เอาไปสวมสิทธิ์ไม่ได้
        id: s.id,
        current: s.id === current,
        createdAt: s.created_at,
        lastSeen: s.last_seen,
        expires: s.expires,
        ip: s.ip,
        ...describeDevice(s.user_agent),
      })),
    );
  });

  r.post("/api/sessions/revoke", async (req: Request, res: Response) => {
    const userId = String(res.locals.userId);
    const current = String(res.locals.sessionId);
    const id = String(req.body?.id ?? "");
    if (!id) {
      res.status(400).json({ ok: false, message: "ไม่ได้ระบุเครื่อง" });
      return;
    }
    // เตะเครื่องตัวเองผ่านหน้านี้ = งง ว่าทำไมจู่ ๆ หลุด — ให้ใช้ปุ่มออกจากระบบแทน
    if (id === current) {
      res.status(400).json({
        ok: false,
        message: "นี่คือเครื่องที่ใช้อยู่ — ใช้ปุ่มออกจากระบบแทน",
      });
      return;
    }
    const ok = revokeSession(userId, id);
    res.json({ ok, message: ok ? "เตะเครื่องนั้นออกแล้ว" : "ไม่พบเครื่องนี้" });
    if (ok && client) {
      await logEvent(client, "warn", "system", "system_login", "เตะอุปกรณ์ออกจากระบบ", [
        { name: "บัญชี", value: `${res.locals.username} (${userId})` },
      ]);
    }
  });

  r.post("/api/sessions/revoke-others", async (_req: Request, res: Response) => {
    const userId = String(res.locals.userId);
    const current = String(res.locals.sessionId);
    const n = revokeOtherSessions(userId, current);
    res.json({
      ok: true,
      message: n ? `เตะออก ${n} เครื่อง` : "ไม่มีเครื่องอื่นที่ค้างอยู่",
    });
    if (n && client) {
      await logEvent(client, "warn", "system", "system_login", "ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้", [
        { name: "บัญชี", value: `${res.locals.username} (${userId})` },
        { name: "จำนวน", value: `${n} เครื่อง` },
      ]);
    }
  });

  return r;
}
