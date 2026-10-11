import type Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";

/**
 * ประวัติแชทกับ Claude ของหน้า "ผู้ช่วย AI" — แยกต่อบัญชี dashboard
 *
 * เก็บ content block ตามที่ API ส่งมาเป๊ะ ๆ (รวม thinking / tool_use / tool_result)
 * ตาถัดไปส่งประวัติกลับไปทั้งก้อน ห้ามแก้หรือลบข้อความกลาง thread
 */

export type ChatMessageParam = Anthropic.Beta.BetaMessageParam;

export interface ChatThread {
  id: number;
  owner: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ChatActionRow {
  tool_use_id: string;
  thread_id: number;
  status: "done" | "dismissed";
  result: string | null;
  decided_by: string;
  decided_at: number;
}

export function createThread(owner: string, title: string): ChatThread {
  const now = Date.now();
  const info = db
    .prepare("INSERT INTO chat_threads (owner, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(owner, title, now, now);
  return { id: Number(info.lastInsertRowid), owner, title, created_at: now, updated_at: now };
}

export function listThreads(owner: string, limit = 50): ChatThread[] {
  return db
    .prepare("SELECT * FROM chat_threads WHERE owner = ? ORDER BY updated_at DESC LIMIT ?")
    .all(owner, limit) as ChatThread[];
}

/** คืน thread เฉพาะเมื่อเป็นของ owner คนนี้ — กัน admin คนหนึ่งเปิดแชทของอีกคน */
export function getThread(id: number, owner: string): ChatThread | undefined {
  return db
    .prepare("SELECT * FROM chat_threads WHERE id = ? AND owner = ?")
    .get(id, owner) as ChatThread | undefined;
}

export const deleteThread = db.transaction((id: number, owner: string): boolean => {
  const changes = db.prepare("DELETE FROM chat_threads WHERE id = ? AND owner = ?").run(id, owner).changes;
  if (changes === 0) return false;
  db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(id);
  db.prepare("DELETE FROM chat_actions WHERE thread_id = ?").run(id);
  return true;
});

export function getMessages(threadId: number): ChatMessageParam[] {
  const rows = db
    .prepare("SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY id ASC")
    .all(threadId) as { role: "user" | "assistant"; content: string }[];
  return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) as ChatMessageParam["content"] }));
}

/** ต่อท้ายข้อความหลายอันในทีเดียว (ตาเดียวของ tool loop) */
export const appendMessages = db.transaction((threadId: number, messages: ChatMessageParam[]) => {
  const now = Date.now();
  const ins = db.prepare(
    "INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const m of messages) {
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    ins.run(threadId, m.role, JSON.stringify(content), now);
  }
  db.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(now, threadId);
});

export function setActionStatus(row: Omit<ChatActionRow, "decided_at">): void {
  db.prepare(
    `INSERT INTO chat_actions (tool_use_id, thread_id, status, result, decided_by, decided_at)
     VALUES (@tool_use_id, @thread_id, @status, @result, @decided_by, @decided_at)
     ON CONFLICT(tool_use_id) DO NOTHING`,
  ).run({ ...row, decided_at: Date.now() });
}

export function getActions(threadId: number): Map<string, ChatActionRow> {
  const rows = db
    .prepare("SELECT * FROM chat_actions WHERE thread_id = ?")
    .all(threadId) as ChatActionRow[];
  return new Map(rows.map((r) => [r.tool_use_id, r]));
}
