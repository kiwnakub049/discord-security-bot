/** ตั้งค่าบอท, หน้าจอ OLED บนตัวเครื่อง และรายชื่อคนที่เข้า dashboard ได้ */
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
import { guildOf, roleOf } from "../../auth/access.js";
import { config } from "../../config.js";
import { isOwner, requireSystemView } from "../middleware/auth.js";
import { logEvent } from "../../utils/logger.js";

export function adminRoutes(client?: Client): Router {
  const r = Router();

  // ตั้งค่าบอท / OLED / รายชื่อคนเข้าได้ — mod กับเจ้าของใช้ได้, admin คนอื่นไม่เห็น (ดู seesSystem)
  r.use(["/api/settings", "/api/oled", "/api/access"], requireSystemView);

  // ---------- ตั้งค่าบอท ----------
  /*
   * ยศที่นับเป็น admin/mod (dashboard.*) แก้ได้แค่เจ้าของ — ไม่งั้น mod ใส่ยศตัวเองเป็น admin
   * แล้วเลื่อนขั้นตัวเองได้ · คนอื่นไม่เห็นหัวข้อนี้เลย และส่งมาก็ถูกตัดทิ้ง
   */
  const ownerOnlyKey = (k: string) => k.startsWith("dashboard.");

  r.get("/api/settings", (_req: Request, res: Response) => {
    const all = getSettings();
    res.json(
      isOwner(res.locals.userId)
        ? all
        : all
            .map((s) => ({ ...s, items: s.items.filter((i) => !ownerOnlyKey(i.key)) }))
            .filter((s) => s.items.length > 0),
    );
  });

  r.post("/api/settings", async (req: Request, res: Response) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ ok: false, message: "ข้อมูลไม่ถูกต้อง" });
      return;
    }
    const patch = Object.fromEntries(
      Object.entries(req.body as Record<string, unknown>).filter(
        ([k]) => isOwner(res.locals.userId) || !ownerOnlyKey(k),
      ),
    );
    updateSettings(patch);
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
  /**
   * ใครเข้า dashboard ได้บ้างตอนนี้ — ดูอย่างเดียว เพิ่ม/ถอดสิทธิ์ทำที่ยศใน Discord
   * (ตั้งว่ายศไหนเป็น admin/mod ได้ในหน้าตั้งค่าบอท หัวข้อ "สิทธิ์เข้า dashboard")
   */
  r.get("/api/access", async (_req: Request, res: Response) => {
    const guild = client ? guildOf(client) : null;
    if (!guild) {
      res.json({ roles: [], people: [] });
      return;
    }
    // ดึงสมาชิกทั้งหมดครั้งหนึ่ง (cache อาจมีแค่คนที่เพิ่งเคลื่อนไหว) — พลาดก็ใช้ที่มีใน cache
    await guild.members.fetch().catch(() => null);
    const roleName = (id: string) => guild.roles.cache.get(id)?.name ?? null;
    const roles = [
      ...config.dashboard.adminRoleIds.map((id) => ({ id, name: roleName(id), role: "admin" as const })),
      ...config.dashboard.modRoleIds.map((id) => ({ id, name: roleName(id), role: "mod" as const })),
    ];
    const people = [...guild.members.cache.values()]
      .filter((m) => !m.user.bot)
      .map((m) => ({ id: m.id, name: m.user.username, role: roleOf(m) }))
      .filter((p): p is { id: string; name: string; role: "admin" | "mod" } => p.role !== null)
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));
    res.json({ roles, people });
  });

  return r;
}
