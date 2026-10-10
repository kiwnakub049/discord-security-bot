/** คิวรอดำเนินการ — แถบบนสุดของหน้าแรก และแผ่นตัดสินทีละเรื่อง */
import { Router, type Request, type Response } from "express";
import type { Client, Guild } from "discord.js";
import {
  categoryDef,
  compareStacks,
  QUEUE_CATEGORIES,
  type QueueCategoryDef,
} from "../../modules/queueCategories.js";
import { getItem, listOpen, openSummary, resolve, type QueueRow } from "../../store/queueStore.js";
import { dmAction } from "../../modules/dmNotice.js";
import { notifyTicketClosed, TICKET_CATEGORY } from "../../modules/ticket.js";
import { logEvent } from "../../utils/logger.js";
import { resolveNames } from "../userNames.js";

/** รายการบนสุดของกองที่ส่งไปพร้อมสรุป — พอให้เห็นหน้าการ์ดใบบนกับขอบใบถัดไป */
const PREVIEW = 3;

export function queueRoutes(client?: Client): Router {
  const r = Router();

  const getGuild = (): Guild | null => {
    if (!client) return null;
    const gid = process.env.GUILD_ID;
    return (gid ? client.guilds.cache.get(gid) : null) ?? client.guilds.cache.first() ?? null;
  };

  async function present(rows: QueueRow[]) {
    const ids = [...new Set(rows.map((x) => x.subject_id).filter((x): x is string => !!x))];
    const names = await resolveNames(client, ids);
    return rows.map((x) => ({
      id: x.id,
      title: x.title,
      detail: x.detail,
      subjectId: x.subject_id,
      subjectName: x.subject_id ? (names[x.subject_id] ?? null) : null,
      createdAt: x.created_at,
    }));
  }

  const meta = (d: QueueCategoryDef) => ({
    key: d.key,
    label: d.label,
    severity: d.severity,
    overdueAfterMin: d.overdueAfterMin,
    verb: d.verb,
    unit: d.unit,
    outcomes: d.outcomes.map(({ key, label, tone }) => ({ key, label, tone })),
  });

  r.get("/api/queue", async (_req: Request, res: Response) => {
    const now = Date.now();
    const counts = new Map(openSummary().map((s) => [s.category, s]));
    const stacks = [];
    const idle = [];
    for (const def of QUEUE_CATEGORIES) {
      const s = counts.get(def.key);
      if (!s || s.count === 0) {
        idle.push({ key: def.key, label: def.label });
        continue;
      }
      stacks.push({
        ...meta(def),
        count: s.count,
        oldestAt: s.oldestAt,
        items: await present(listOpen(def.key, PREVIEW)),
      });
    }
    stacks.sort((a, b) => compareStacks(a, b, now));
    res.json({ stacks, idle, now });
  });

  r.get("/api/queue/:category", async (req: Request, res: Response) => {
    const def = categoryDef(String(req.params.category));
    if (!def) {
      res.status(404).json({ ok: false, message: "ไม่มีหมวดนี้" });
      return;
    }
    res.json({ category: meta(def), items: await present(listOpen(def.key)) });
  });

  r.post("/api/queue/:id/resolve", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const actor = String(res.locals.username);
    const item = Number.isInteger(id) ? getItem(id) : undefined;
    const def = item ? categoryDef(item.category) : undefined;
    const outcome = def?.outcomes.find((o) => o.key === req.body?.outcome);
    if (!item || !def || !outcome) {
      res.status(400).json({ ok: false, message: "ไม่พบเรื่องนี้หรือตัวเลือกไม่ถูกต้อง" });
      return;
    }
    if (item.resolved_at) {
      res.status(409).json({
        ok: false,
        message: `เรื่องนี้ถูกตัดสินไปแล้วโดย ${item.resolved_by ?? "คนอื่น"}`,
      });
      return;
    }

    // ทำผลข้างเคียงจริงก่อน แล้วค่อยปิดเรื่อง — ถ้าแบนไม่สำเร็จ เรื่องต้องยังค้างให้กดใหม่ได้
    if (outcome.effect === "ban") {
      const guild = getGuild();
      if (!guild || !item.subject_id) {
        res.status(400).json({ ok: false, message: "แบนไม่ได้: ไม่พบเซิร์ฟเวอร์หรือไม่รู้ว่าเป็นใคร" });
        return;
      }
      const reason = `${def.label}: ${item.title}`;
      try {
        const member = await guild.members.fetch(item.subject_id).catch(() => null);
        if (member) {
          await dmAction(member, "ban", reason);
          await member.ban({ reason });
        } else {
          await guild.members.ban(item.subject_id, { reason });
        }
      } catch {
        res.status(500).json({ ok: false, message: "แบนไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)" });
        return;
      }
    }

    if (!resolve(item.id, outcome.key, actor)) {
      res.status(409).json({ ok: false, message: "เรื่องนี้ถูกตัดสินไปแล้ว" });
      return;
    }
    res.json({ ok: true, message: `${outcome.doneText}: ${item.title}` });

    if (client && item.category === TICKET_CATEGORY) {
      await notifyTicketClosed(client, item, getGuild()?.name);
    }

    if (client) {
      await logEvent(
        client,
        outcome.effect === "ban" ? "alert" : "info",
        "audit",
        // ใช้ event เดิมของต้นไม้ log — การแบนจากคิวควรไปอยู่กองเดียวกับการแบนทั่วไป
        outcome.effect === "ban" ? "audit_ban" : "audit_member",
        `${def.label}: ${outcome.label} (จาก dashboard)`,
        [
          { name: "เรื่อง", value: item.title },
          ...(item.subject_id ? [{ name: "เป้าหมาย", value: item.subject_id }] : []),
          { name: "โดย (dashboard)", value: actor },
        ],
      );
    }
  });

  return r;
}
