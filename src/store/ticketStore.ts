import { db } from "./db.js";

/**
 * ข้อความในบทสนทนาของ ticket — ตำรวจกับแอดมินคุยกันผ่าน DM ของบอท
 * เก็บทุกข้อความไว้ที่นี่ หน้าเว็บอ่านจากตารางนี้ (ไม่ต้องไปดึง DM ย้อนหลังจาก Discord)
 */

export type TicketAuthor = "police" | "admin";

export interface TicketMessage {
  id: number;
  queue_id: number;
  author_kind: TicketAuthor;
  author_id: string | null;
  author_name: string;
  body: string;
  attachments: string | null;
  delivered: number | null;
  created_at: number;
}

const insert = db.prepare(
  `INSERT INTO ticket_messages
     (queue_id, author_kind, author_id, author_name, body, attachments, delivered, created_at)
   VALUES (@queue_id, @author_kind, @author_id, @author_name, @body, @attachments, @delivered, @created_at)`,
);

export function addMessage(m: {
  queueId: number;
  authorKind: TicketAuthor;
  authorId?: string | null;
  authorName: string;
  body: string;
  attachments?: string[];
  /** ฝั่งแอดมินเท่านั้น: DM ถึงตำรวจไหม */
  delivered?: boolean | null;
  at?: number;
}): number {
  const info = insert.run({
    queue_id: m.queueId,
    author_kind: m.authorKind,
    author_id: m.authorId ?? null,
    author_name: m.authorName,
    body: m.body,
    attachments: m.attachments?.length ? m.attachments.join("\n") : null,
    delivered: m.delivered == null ? null : m.delivered ? 1 : 0,
    created_at: m.at ?? Date.now(),
  });
  return Number(info.lastInsertRowid);
}

/** ข้อความทั้งหมดของเรื่อง เก่าสุดก่อน (อ่านแบบแชท) */
export function listMessages(queueId: number): TicketMessage[] {
  return db
    .prepare("SELECT * FROM ticket_messages WHERE queue_id = ? ORDER BY created_at ASC, id ASC")
    .all(queueId) as TicketMessage[];
}

/**
 * สรุปบทสนทนาต่อเรื่อง: จำนวนข้อความ + ใครพูดล่าสุดเมื่อไร
 * ให้การ์ดในคิวบอกได้ว่า "ตำรวจตอบมาแล้ว รอแอดมิน" โดยไม่ต้องโหลดข้อความทั้งหมด
 */
export function threadSummary(
  queueIds: number[],
): Map<number, { count: number; lastFrom: TicketAuthor; lastAt: number }> {
  const out = new Map<number, { count: number; lastFrom: TicketAuthor; lastAt: number }>();
  if (!queueIds.length) return out;
  const marks = queueIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT queue_id, COUNT(*) AS count, MAX(created_at) AS lastAt,
              (SELECT author_kind FROM ticket_messages t2
                WHERE t2.queue_id = t.queue_id
                ORDER BY created_at DESC, id DESC LIMIT 1) AS lastFrom
         FROM ticket_messages t
        WHERE queue_id IN (${marks})
        GROUP BY queue_id`,
    )
    .all(...queueIds) as { queue_id: number; count: number; lastAt: number; lastFrom: TicketAuthor }[];
  for (const r of rows) out.set(r.queue_id, { count: r.count, lastFrom: r.lastFrom, lastAt: r.lastAt });
  return out;
}
