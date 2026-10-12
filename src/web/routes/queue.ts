/** คิวรอดำเนินการ — แถบบนสุดของหน้าแรก และแผ่นตัดสินทีละเรื่อง */
import { Router, type Request, type Response } from "express";
import type { Client, Guild } from "discord.js";
import {
  categoryDef,
  compareStacks,
  QUEUE_CATEGORIES,
  type QueueCategoryDef,
} from "../../modules/queueCategories.js";
import {
  getItem,
  itemLogIds,
  itemRefs,
  listOpen,
  openSummary,
  resolve,
  type QueueRow,
} from "../../store/queueStore.js";
import { getLogById } from "../../store/logStore.js";
import { warnMember } from "../../modules/warnAction.js";
import { recordAiVerdict } from "./ai.js";
import { tr, type Lang } from "../i18n.js";
import { deleteMessageRefs } from "../../modules/deleteRefs.js";
import { dmAction } from "../../modules/dmNotice.js";
import { notifyTicketClosed, replyToTicket, TICKET_CATEGORY } from "../../modules/ticket.js";
import { listMessages, threadSummary } from "../../store/ticketStore.js";
import { logEvent } from "../../utils/logger.js";
import { resolveNames } from "../userNames.js";

/** รายการบนสุดของกองที่ส่งไปพร้อมสรุป — พอให้เห็นหน้าการ์ดใบบนกับขอบใบถัดไป */
const PREVIEW = 3;
/** ข้อความแอดมินยาวสุด — DM ของ Discord รับได้ 2000 ตัว เผื่อหัวข้อความที่บอทเติมให้ */
const REPLY_MAX = 1500;
/** หมายเหตุตอนตัดสิน — ไปทั้ง log, คำตัดสิน AI และเหตุผลใน DM ที่ส่งถึงสมาชิก */
const NOTE_MAX = 300;

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
    // เฉพาะ ticket: สรุปบทสนทนา ให้การ์ดบอกได้ว่าตำรวจตอบมาแล้วรอแอดมินอยู่
    const threads = threadSummary(rows.filter((x) => x.category === TICKET_CATEGORY).map((x) => x.id));
    return rows.map((x) => ({
      id: x.id,
      title: x.title,
      detail: x.detail,
      subjectId: x.subject_id,
      subjectName: x.subject_id ? (names[x.subject_id] ?? null) : null,
      createdAt: x.created_at,
      thread: threads.get(x.id) ?? null,
      // การ์ดรวมหลายข้อความของคนเดียวกัน — บอกว่ามีกี่ครั้ง (รายละเอียดโชว์แค่ครั้งแรก)
      hits: Math.max(itemLogIds(x).length, 1),
    }));
  }

  // ป้าย/ปุ่มของหมวดเป็นหน้าตาเว็บ ไม่ใช่ข้อมูล — แปลตามภาษาที่เลือก
  const meta = (d: QueueCategoryDef, lang: Lang) => ({
    key: d.key,
    label: tr(d.label, lang),
    severity: d.severity,
    overdueAfterMin: d.overdueAfterMin,
    verb: tr(d.verb, lang),
    unit: tr(d.unit, lang),
    note: !!d.note,
    outcomes: d.outcomes.map(({ key, label, tone }) => ({ key, label: tr(label, lang), tone })),
  });

  r.get("/api/queue", async (_req: Request, res: Response) => {
    const now = Date.now();
    const counts = new Map(openSummary().map((s) => [s.category, s]));
    const stacks = [];
    const idle = [];
    for (const def of QUEUE_CATEGORIES) {
      const s = counts.get(def.key);
      if (!s || s.count === 0) {
        idle.push({ key: def.key, label: tr(def.label, res.locals.lang) });
        continue;
      }
      stacks.push({
        ...meta(def, res.locals.lang),
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
    res.json({ category: meta(def, res.locals.lang), items: await present(listOpen(def.key)) });
  });

  /** เรื่อง ticket จาก id ใน URL — ไม่ใช่ ticket หรือไม่มีจริง = undefined */
  const ticketOf = (raw: unknown) => {
    const id = Number(raw);
    const item = Number.isInteger(id) ? getItem(id) : undefined;
    return item?.category === TICKET_CATEGORY ? item : undefined;
  };

  r.get("/api/tickets/:id/messages", (req: Request, res: Response) => {
    const item = ticketOf(req.params.id);
    if (!item) {
      res.status(404).json({ ok: false, message: "ไม่พบ ticket นี้" });
      return;
    }
    res.json({
      open: item.resolved_at == null,
      messages: listMessages(item.id).map((m) => ({
        id: m.id,
        from: m.author_kind,
        userId: m.author_id,
        name: m.author_name,
        body: m.body,
        attachments: m.attachments ? m.attachments.split("\n") : [],
        delivered: m.delivered == null ? null : m.delivered === 1,
        at: m.created_at,
      })),
    });
  });

  r.post("/api/tickets/:id/reply", async (req: Request, res: Response) => {
    const item = ticketOf(req.params.id);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!item) {
      res.status(404).json({ ok: false, message: "ไม่พบ ticket นี้" });
      return;
    }
    // ปิดแล้วห้ามตอบ — DM ของตำรวจหลังปิดจะไม่ถูกเก็บเข้าเรื่องนี้แล้ว คุยต่อไปก็ไม่เห็นคำตอบ
    if (item.resolved_at) {
      res.status(409).json({ ok: false, message: "ticket นี้ถูกปิดไปแล้ว" });
      return;
    }
    if (!body || body.length > REPLY_MAX) {
      res.status(400).json({ ok: false, message: `ข้อความต้องยาว 1–${REPLY_MAX} ตัวอักษร` });
      return;
    }
    if (!client) {
      res.status(503).json({ ok: false, message: "บอทไม่ได้ต่อ Discord อยู่ ส่ง DM ไม่ได้" });
      return;
    }
    const { delivered } = await replyToTicket(
      client,
      item,
      { id: String(res.locals.userId), name: String(res.locals.username) },
      body,
    );
    res.json({
      ok: true,
      delivered,
      message: delivered ? "ส่งถึงตำรวจทาง DM แล้ว" : "บันทึกแล้ว แต่ DM ไม่ถึง (ตำรวจอาจปิด DM)",
    });
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
    const rawNote = req.body?.note;
    const note = def.note && typeof rawNote === "string" ? rawNote.trim().slice(0, NOTE_MAX) : "";

    // ทำผลข้างเคียงจริงก่อน แล้วค่อยปิดเรื่อง — ถ้าลบ/แบนไม่สำเร็จ เรื่องต้องยังค้างให้กดใหม่ได้
    const wantsDelete = outcome.effect === "delete" || outcome.effect === "deleteAndBan";
    const wantsBan = outcome.effect === "ban" || outcome.effect === "deleteAndBan";
    let deleteNote = "";
    if (wantsDelete) {
      if (!client) {
        res.status(400).json({ ok: false, message: "ลบไม่ได้: บอทไม่ได้เชื่อมต่อ Discord" });
        return;
      }
      // กดซ้ำหลังลบไปบางส่วนก็ไม่พัง — ข้อความที่ลบแล้วจะนับเป็น "หายไปก่อนแล้ว"
      const d = await deleteMessageRefs(client, itemRefs(item));
      if (d.failed > 0) {
        res.status(500).json({
          ok: false,
          message: `ลบไม่ได้ ${d.failed} ข้อความ (เช็คสิทธิ์ Manage Messages ของบอท)`,
        });
        return;
      }
      deleteNote = ` (ลบ ${d.deleted} ข้อความ${d.gone ? ` · หายไปก่อนแล้ว ${d.gone}` : ""})`;
    }
    if (wantsBan) {
      const guild = getGuild();
      if (!guild || !item.subject_id) {
        res.status(400).json({ ok: false, message: "แบนไม่ได้: ไม่พบเซิร์ฟเวอร์หรือไม่รู้ว่าเป็นใคร" });
        return;
      }
      const reason = `${def.label}: ${item.title}${note ? ` — ${note}` : ""}`;
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

    let actionNote = "";
    if (outcome.effect === "warn" || outcome.effect === "timeout") {
      const guild = getGuild();
      const member =
        guild && item.subject_id ? await guild.members.fetch(item.subject_id).catch(() => null) : null;
      if (!member) {
        res.status(404).json({ ok: false, message: "ไม่พบสมาชิกในเซิร์ฟเวอร์ (อาจออกไปแล้ว)" });
        return;
      }
      // เหตุผลนี้ไปถึงสมาชิกทาง DM — ใช้หมายเหตุของ mod ถ้ามี
      const reason = note || "ข้อความไม่สุภาพ";
      try {
        if (outcome.effect === "warn") {
          const w = await warnMember(member, String(res.locals.userId), actor, reason);
          actionNote = ` (ครั้งที่ ${w.count}${w.actionMsg ? ` ${w.actionMsg}` : ""})`;
        } else {
          const ms = (outcome.timeoutMin ?? 60) * 60_000;
          await dmAction(member, "timeout", reason, ms);
          await member.timeout(ms, reason);
        }
      } catch {
        res.status(500).json({ ok: false, message: "ทำไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)" });
        return;
      }
    }

    if (!resolve(item.id, outcome.key, actor, note)) {
      res.status(409).json({ ok: false, message: "เรื่องนี้ถูกตัดสินไปแล้ว" });
      return;
    }
    // ประกอบทีละชิ้นแล้วแปลแยก — หัวข้อเรื่องเป็นข้อมูล ไม่แปล
    const lang: Lang = res.locals.lang;
    res.json({
      ok: true,
      message: `${tr(outcome.doneText, lang)}${tr(actionNote, lang)}${tr(deleteNote, lang)}: ${item.title}`,
    });

    // ถูก/ผิดของ Claude ย้อนไปติดที่ log ต้นทางทุกอัน — ไม่ต้องไปกดซ้ำในหน้า Logs
    if (outcome.verdict) {
      for (const logId of itemLogIds(item)) {
        const entry = getLogById(logId);
        if (entry) recordAiVerdict(entry, outcome.verdict, actor, note);
      }
    }

    if (client && item.category === TICKET_CATEGORY) {
      await notifyTicketClosed(client, item, getGuild()?.name);
    }

    if (client) {
      await logEvent(
        client,
        wantsBan ? "alert" : outcome.effect ? "warn" : "info",
        outcome.effect === "warn" ? "security" : "audit",
        // ใช้ event เดิมของต้นไม้ log — การแบนจากคิวควรไปอยู่กองเดียวกับการแบนทั่วไป
        wantsBan
          ? "audit_ban"
          : outcome.effect === "timeout"
            ? "audit_timeout"
            : outcome.effect === "warn"
              ? "security_warn"
              : "audit_member",
        `${def.label}: ${outcome.label} (จาก dashboard)`,
        [
          { name: "เรื่อง", value: item.title },
          ...(item.subject_id ? [{ name: "เป้าหมาย", value: item.subject_id }] : []),
          ...(deleteNote ? [{ name: "ลบข้อความ", value: deleteNote.trim().slice(1, -1) }] : []),
          ...(actionNote ? [{ name: "เตือนสะสม", value: actionNote.trim().slice(1, -1) }] : []),
          ...(note ? [{ name: "หมายเหตุ", value: note }] : []),
          { name: "โดย (dashboard)", value: actor },
        ],
      );
    }
  });

  return r;
}
