/**
 * หน้าแชทกับ Claude เรื่องเซิร์ฟ — เฉพาะ admin
 * thread เป็นของบัญชีใครบัญชีมัน (admin คนอื่นเปิดไม่ได้)
 */
import Anthropic from "@anthropic-ai/sdk";
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { requireAdmin, requireSystemView } from "../middleware/auth.js";
import {
  createThread,
  deleteThread,
  getActions,
  getMessages,
  getThread,
  listThreads,
  setActionStatus,
  type ChatMessageParam,
} from "../../store/chatStore.js";
import { AssistantError, runAssistantTurn, titleFrom } from "../../modules/serverAssistant.js";
import { resolveNames } from "../userNames.js";

const TEXT_MAX = 4000;

/** ป้ายที่โชว์ระหว่างทางว่า Claude ไปดูอะไรมา */
const TOOL_LABEL: Record<string, string> = {
  server_overview: "ดูภาพรวมเซิร์ฟ",
  log_event_counts: "นับ log แยกชนิด",
  search_logs: "ค้น log",
  find_member: "ค้นหาสมาชิก",
  member_detail: "ดูประวัติสมาชิก",
  top_warned: "ดูคนโดนเตือนเยอะสุด",
  queue_open: "ดูคิวที่ค้าง",
};

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; label: string; detail: string | null }
  | {
      kind: "proposal";
      toolUseId: string;
      action: string;
      userId: string;
      userName: string | null;
      reason: string;
      minutes: number | null;
      status: "pending" | "done" | "dismissed";
      result: string | null;
    };

/** ข้อความดิบจาก API → รายการที่หน้าเว็บวาด (ซ่อน thinking / tool_result / fallback) */
async function present(client: Client | undefined, threadId: number, messages: ChatMessageParam[]): Promise<ChatItem[]> {
  const actions = getActions(threadId);
  const items: ChatItem[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const kind = m.role;
    if (typeof m.content === "string") {
      items.push({ kind, text: m.content });
      continue;
    }
    for (const b of m.content) {
      if (b.type === "text" && b.text.trim()) {
        items.push({ kind, text: b.text });
      } else if (b.type === "tool_use") {
        const input = (b.input ?? {}) as Record<string, unknown>;
        if (b.name === "propose_action") {
          const done = actions.get(b.id);
          items.push({
            kind: "proposal",
            toolUseId: b.id,
            action: String(input.action ?? ""),
            userId: String(input.user_id ?? ""),
            userName: null,
            reason: String(input.reason ?? ""),
            minutes: Number.isFinite(Number(input.minutes)) ? Number(input.minutes) : null,
            status: done?.status ?? "pending",
            result: done?.result ?? null,
          });
        } else {
          const detail = [input.query, input.user_id].find((v) => typeof v === "string" && v) as string | undefined;
          items.push({ kind: "tool", label: TOOL_LABEL[b.name] ?? b.name, detail: detail ?? null });
        }
      }
    }
  }
  const ids = [...new Set(items.flatMap((i) => (i.kind === "proposal" && i.userId ? [i.userId] : [])))];
  const names = await resolveNames(client, ids);
  for (const i of items) if (i.kind === "proposal") i.userName = names[i.userId] ?? null;
  return items;
}

/** error ของ API → ข้อความที่ admin อ่านรู้เรื่อง */
function errorMessage(err: unknown): string {
  if (err instanceof AssistantError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "API key ไม่ถูกต้อง (เช็ค ANTHROPIC_API_KEY ใน .env)";
  if (err instanceof Anthropic.RateLimitError) return "ติด rate limit ของ Claude API — รอสักครู่แล้วลองใหม่";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "Claude ตอบช้าเกินไป — ลองใหม่อีกครั้ง";
  if (err instanceof Anthropic.APIConnectionError) return "เชื่อมต่อ Claude API ไม่ได้";
  if (err instanceof Anthropic.APIError) return `Claude API ผิดพลาด (${err.status ?? "?"})`;
  return "เกิดข้อผิดพลาด";
}

export function chatRoutes(client?: Client): Router {
  const r = Router();
  // admin เท่านั้น และไม่ใช่ admin ทั่วไป (ดู seesSystem) → เหลือแค่เจ้าของ
  r.use("/api/chat", requireAdmin, requireSystemView);

  // ทีละคำถามต่อ thread — กดส่งรัว ๆ จะได้ไม่ยิง API ซ้อนแล้วประวัติสลับลำดับ
  const busy = new Set<number>();

  // ผูกแชทกับ Discord user ID ไม่ใช่ชื่อ — ชื่อ Discord เปลี่ยนได้ ไม่งั้นเปลี่ยนชื่อแล้วแชทเก่าหาย
  const owner = (res: Response) => String(res.locals.userId);
  const parseText = (req: Request): string | null => {
    const t = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    return t && t.length <= TEXT_MAX ? t : null;
  };

  async function ask(threadId: number, text: string, res: Response): Promise<boolean> {
    if (!client) {
      res.status(503).json({ ok: false, message: "บอทไม่ได้เชื่อมต่อ Discord" });
      return false;
    }
    if (busy.has(threadId)) {
      res.status(409).json({ ok: false, message: "Claude กำลังตอบคำถามก่อนหน้าอยู่" });
      return false;
    }
    busy.add(threadId);
    try {
      await runAssistantTurn(client, threadId, text);
      return true;
    } catch (err) {
      if (!(err instanceof AssistantError)) console.error("assistant turn พัง:", err);
      res.status(502).json({ ok: false, message: errorMessage(err) });
      return false;
    } finally {
      busy.delete(threadId);
    }
  }

  r.get("/api/chat/threads", (_req: Request, res: Response) => {
    res.json({ threads: listThreads(owner(res)) });
  });

  /** เริ่มแชทใหม่ด้วยคำถามแรก */
  r.post("/api/chat/threads", async (req: Request, res: Response) => {
    const text = parseText(req);
    if (!text) {
      res.status(400).json({ ok: false, message: `พิมพ์คำถาม (ไม่เกิน ${TEXT_MAX} ตัวอักษร)` });
      return;
    }
    const thread = createThread(owner(res), titleFrom(text));
    if (!(await ask(thread.id, text, res))) {
      // ตาแรกพัง = thread ว่างเปล่า ไม่ต้องเก็บไว้ให้รก
      deleteThread(thread.id, owner(res));
      return;
    }
    res.json({ ok: true, thread, items: await present(client, thread.id, getMessages(thread.id)) });
  });

  r.get("/api/chat/threads/:id", async (req: Request, res: Response) => {
    const thread = getThread(Number(req.params.id), owner(res));
    if (!thread) {
      res.status(404).json({ ok: false, message: "ไม่พบแชทนี้" });
      return;
    }
    res.json({
      thread,
      busy: busy.has(thread.id),
      items: await present(client, thread.id, getMessages(thread.id)),
    });
  });

  r.post("/api/chat/threads/:id/messages", async (req: Request, res: Response) => {
    const thread = getThread(Number(req.params.id), owner(res));
    const text = parseText(req);
    if (!thread) {
      res.status(404).json({ ok: false, message: "ไม่พบแชทนี้" });
      return;
    }
    if (!text) {
      res.status(400).json({ ok: false, message: `พิมพ์คำถาม (ไม่เกิน ${TEXT_MAX} ตัวอักษร)` });
      return;
    }
    if (!(await ask(thread.id, text, res))) return;
    res.json({ ok: true, thread, items: await present(client, thread.id, getMessages(thread.id)) });
  });

  r.delete("/api/chat/threads/:id", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (busy.has(id)) {
      res.status(409).json({ ok: false, message: "รอ Claude ตอบเสร็จก่อนค่อยลบ" });
      return;
    }
    const ok = deleteThread(id, owner(res));
    res.status(ok ? 200 : 404).json({ ok, message: ok ? "ลบแชทแล้ว" : "ไม่พบแชทนี้" });
  });

  /**
   * บันทึกว่า admin ทำ/ไม่ทำ action ที่ Claude เสนอ
   * ตัวลงมือจริงคือ /api/action/* เดิม (หน้าเว็บเรียกก่อน แล้วค่อยมาบันทึกตรงนี้)
   */
  r.post("/api/chat/threads/:id/actions/:toolUseId", (req: Request, res: Response) => {
    const thread = getThread(Number(req.params.id), owner(res));
    const status = req.body?.status;
    if (!thread || (status !== "done" && status !== "dismissed")) {
      res.status(400).json({ ok: false, message: "ข้อมูลไม่ถูกต้อง" });
      return;
    }
    const toolUseId = String(req.params.toolUseId);
    const proposed = getMessages(thread.id).some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "tool_use" && b.name === "propose_action" && b.id === toolUseId),
    );
    if (!proposed) {
      res.status(404).json({ ok: false, message: "ไม่พบข้อเสนอนี้" });
      return;
    }
    setActionStatus({
      tool_use_id: toolUseId,
      thread_id: thread.id,
      status,
      result: typeof req.body?.result === "string" ? req.body.result.slice(0, 300) : null,
      decided_by: owner(res),
    });
    res.json({ ok: true });
  });

  return r;
}
