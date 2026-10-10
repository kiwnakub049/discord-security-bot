/** ตั้งค่าบอท, หน้าจอ OLED บนตัวเครื่อง และบัญชีผู้ดูแล */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { getSettings, updateSettings } from "../../store/settingsStore.js";
import {
  getOledConfig,
  isOledPage,
  OLED_PAGE_LABELS,
  OLED_PAGES,
  setOledConfig,
} from "../../utils/oledConfig.js";
import {
  addUser,
  isRole,
  listUsers,
  listUsersWithRoles,
  removeUser,
  setRole,
} from "../../auth/users.js";
import { requireAdmin } from "../middleware/auth.js";
import { logEvent } from "../../utils/logger.js";

export function adminRoutes(client?: Client): Router {
  const r = Router();

  // ---------- ตั้งค่าบอท ----------
  r.get("/api/settings", (_req: Request, res: Response) => {
    res.json(getSettings());
  });

  r.post("/api/settings", requireAdmin, async (req: Request, res: Response) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ ok: false, message: "ข้อมูลไม่ถูกต้อง" });
      return;
    }
    updateSettings(req.body as Record<string, unknown>);
    res.json({ ok: true, message: "บันทึกการตั้งค่าแล้ว" });
    if (client) {
      await logEvent(client, "warn", "system", "system_settings", "แก้ไขการตั้งค่า (จาก dashboard)", [
        { name: "โดย", value: String(res.locals.username) },
      ]);
    }
  });

  // ---------- จอ OLED บนตัวเครื่อง ----------
  r.get("/api/oled", (_req: Request, res: Response) => {
    res.json({
      ...getOledConfig(),
      pages: OLED_PAGES.map((p) => ({ id: p, label: OLED_PAGE_LABELS[p] })),
    });
  });

  r.post("/api/oled", async (req: Request, res: Response) => {
    const page = (req.body as { page?: unknown })?.page;
    if (!isOledPage(page)) {
      res.status(400).json({
        ok: false,
        message: `หน้าจอต้องเป็นหนึ่งใน ${OLED_PAGES.join(", ")}`,
      });
      return;
    }
    let saved;
    try {
      saved = setOledConfig(String(page));
    } catch {
      // เขียนไม่ได้ = ปัญหาสิทธิ์ (ReadWritePaths ใน unit) ไม่ใช่ input ผู้ใช้ผิด
      res.status(500).json({ ok: false, message: "เขียนไฟล์ตั้งค่าจอไม่ได้ (สิทธิ์?)" });
      return;
    }
    res.json({ ok: true, message: `จอค้างที่หน้า ${saved.page} แล้ว`, ...saved });
    if (client) {
      await logEvent(client, "info", "system", "system_settings", "เปลี่ยนหน้าจอ OLED", [
        { name: "โดย", value: String(res.locals.username) },
        { name: "หน้าใหม่", value: `${saved.page} — ${OLED_PAGE_LABELS[saved.page]}` },
      ]);
    }
  });

  // ---------- บัญชีผู้ดูแล (admin เท่านั้น) ----------
  r.get("/api/users", requireAdmin, (_req: Request, res: Response) => {
    res.json(listUsersWithRoles());
  });

  r.post("/api/users/add", requireAdmin, async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    // role: รับ 'admin'/'mod' — ค่าอื่นหรือไม่ส่งมา = mod (สิทธิ์ต่ำสุด)
    const roleInput = req.body?.role;
    const role = isRole(roleInput) ? roleInput : "mod";
    // จำกัดรูปแบบ username: a-z A-Z 0-9 _ . - ยาว 3–32 ตัว
    // กัน stored XSS (เช่นชื่อที่มี ' " < >) ที่จะถูกฝังในหน้า dashboard
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
      res.status(400).json({
        ok: false,
        message: "username 3–32 ตัว (a-z 0-9 _ . -) + รหัสผ่าน ≥ 8 ตัว",
      });
      return;
    }
    try {
      await addUser(username, password, role);
      res.json({ ok: true, message: `เพิ่มบัญชี ${username} (${role}) แล้ว` });
      if (client) {
        await logEvent(client, "warn", "system", "system_settings", "เพิ่มบัญชี dashboard (จาก dashboard)", [
          { name: "บัญชีใหม่", value: username },
          { name: "สิทธิ์", value: role },
          { name: "โดย", value: String(res.locals.username) },
        ]);
      }
    } catch {
      res.status(400).json({ ok: false, message: "มีบัญชีนี้อยู่แล้ว" });
    }
  });

  r.post("/api/users/role", requireAdmin, async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "");
    const role = req.body?.role;
    if (!isRole(role)) {
      res.status(400).json({ ok: false, message: "role ต้องเป็น admin หรือ mod" });
      return;
    }
    const ok = setRole(username, role);
    if (!ok) {
      res.status(400).json({
        ok: false,
        message: "เปลี่ยนไม่ได้ — ไม่พบบัญชี หรือเป็น admin คนสุดท้าย",
      });
      return;
    }
    res.json({ ok: true, message: `เปลี่ยน ${username} เป็น ${role} แล้ว` });
    if (client) {
      await logEvent(client, "warn", "system", "system_settings", "เปลี่ยนสิทธิ์บัญชี (จาก dashboard)", [
        { name: "บัญชี", value: username },
        { name: "สิทธิ์ใหม่", value: role },
        { name: "โดย", value: String(res.locals.username) },
      ]);
    }
  });

  r.post("/api/users/remove", requireAdmin, async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "");
    if (listUsers().length <= 1) {
      res.status(400).json({ ok: false, message: "ลบไม่ได้ — ต้องเหลือบัญชีอย่างน้อย 1" });
      return;
    }
    const ok = removeUser(username);
    res.json({
      ok,
      message: ok
        ? `ลบบัญชี ${username} แล้ว`
        : "ลบไม่ได้ — ไม่พบบัญชี หรือเป็น admin คนสุดท้าย",
    });
    if (ok && client) {
      await logEvent(client, "alert", "system", "system_settings", "ลบบัญชี dashboard (จาก dashboard)", [
        { name: "บัญชีที่ลบ", value: username },
        { name: "โดย", value: String(res.locals.username) },
      ]);
    }
  });

  return r;
}
