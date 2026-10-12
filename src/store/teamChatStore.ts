import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "./db.js";

/**
 * แชททีม — admin/mod คุยกันบน dashboard (ห้องรวม + คุยส่วนตัวสองคน)
 *
 * room:
 *   "general"            ห้องรวม ทุกคนที่เข้า dashboard ได้
 *   "dm:<idน้อย>:<idมาก>" คุยกันสองคน (เรียง id ให้ห้องเดียวกันได้ชื่อเดียวกันเสมอ)
 *
 * ไฟล์แนบเก็บในโฟลเดอร์ team-files ข้าง DB (ชื่อไฟล์บนดิสก์ = id สุ่ม ไม่ใช่ชื่อที่ผู้ใช้ตั้ง
 * กันชื่อไฟล์แปลก ๆ เช่น ../../ หลุดออกนอกโฟลเดอร์)
 */

export const GENERAL = "general";
/** เก็บข้อความและไฟล์ 90 วัน */
export const RETENTION_MS = 90 * 86_400_000;
/** ไฟล์ที่อัปแล้วไม่ได้กดส่ง ค้างเกินนี้ลบทิ้ง */
const ORPHAN_MS = 86_400_000;

export const FILES_DIR = join(dirname(db.name), "team-files");
mkdirSync(FILES_DIR, { recursive: true });

const SNOWFLAKE = /^\d{15,21}$/;

export function dmRoom(a: string, b: string): string {
  const [lo, hi] = [a, b].sort();
  return `dm:${lo}:${hi}`;
}

/** สมาชิกของห้อง DM — null = ไม่ใช่ห้อง DM ที่ถูกรูปแบบ */
export function dmMembers(room: string): [string, string] | null {
  const m = /^dm:(\d{15,21}):(\d{15,21})$/.exec(room);
  if (!m || m[1] === m[2] || m[1]! > m[2]!) return null;
  return [m[1]!, m[2]!];
}

/** ผู้ใช้คนนี้เข้าห้องนี้ได้ไหม (ต้องเป็นทีมอยู่แล้ว — เช็คที่ middleware) */
export function canAccessRoom(room: string, userId: string): boolean {
  if (room === GENERAL) return true;
  return dmMembers(room)?.includes(userId) ?? false;
}

export function filePath(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("bad file id");
  return join(FILES_DIR, id);
}

export function newFileId(): string {
  return randomBytes(16).toString("hex");
}

export interface TeamFileRow {
  id: string;
  message_id: number | null;
  uploader_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
}

export function addFile(f: Omit<TeamFileRow, "message_id" | "created_at">): void {
  db.prepare(
    `INSERT INTO team_files (id, message_id, uploader_id, name, mime, size, created_at)
     VALUES (@id, NULL, @uploader_id, @name, @mime, @size, @now)`,
  ).run({ ...f, now: Date.now() });
}

export function getFile(id: string): (TeamFileRow & { room: string | null }) | undefined {
  return db
    .prepare(
      `SELECT f.*, m.room FROM team_files f LEFT JOIN team_messages m ON m.id = f.message_id
       WHERE f.id = ?`,
    )
    .get(id) as (TeamFileRow & { room: string | null }) | undefined;
}

/** ข้อความต้นทางที่ถูกตอบกลับ — ย่อพอให้เห็นว่าตอบอันไหน · gone = ต้นทางถูกลบไปแล้ว (เก่าเกิน 90 วัน) */
export interface TeamReplyRef {
  id: number;
  authorId: string | null;
  authorName: string | null;
  excerpt: string;
  files: number;
  gone: boolean;
}

export interface TeamMessage {
  id: number;
  room: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: number;
  files: { id: string; name: string; mime: string; size: number }[];
  replyTo: TeamReplyRef | null;
}

/** ความยาวข้อความต้นทางที่ส่งไปพร้อมคำตอบ */
const REPLY_EXCERPT = 140;

/** ข้อความต้นทางที่ตอบได้ — ต้องอยู่ห้องเดียวกัน (กันอ้างข้อความจากห้อง DM ของคนอื่น) */
export function getReplyTarget(room: string, id: number): { id: number; author_id: string } | undefined {
  return db.prepare("SELECT id, author_id FROM team_messages WHERE id = ? AND room = ?").get(id, room) as
    | { id: number; author_id: string }
    | undefined;
}

function replyRefs(ids: number[]): Map<number, TeamReplyRef> {
  const out = new Map<number, TeamReplyRef>();
  if (!ids.length) return out;
  const rows = db
    .prepare(
      `SELECT m.id, m.author_id, m.author_name, m.body,
              (SELECT COUNT(*) FROM team_files f WHERE f.message_id = m.id) AS files
       FROM team_messages m WHERE m.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as { id: number; author_id: string; author_name: string; body: string; files: number }[];
  for (const r of rows) {
    const body = r.body.replace(/\s+/g, " ").trim();
    out.set(r.id, {
      id: r.id,
      authorId: r.author_id,
      authorName: r.author_name,
      excerpt: body.length > REPLY_EXCERPT ? `${body.slice(0, REPLY_EXCERPT)}…` : body,
      files: r.files,
      gone: false,
    });
  }
  for (const id of ids) {
    if (!out.has(id)) out.set(id, { id, authorId: null, authorName: null, excerpt: "", files: 0, gone: true });
  }
  return out;
}

interface MsgRow {
  id: number;
  room: string;
  author_id: string;
  author_name: string;
  body: string;
  mentions: string;
  created_at: number;
  reply_to: number | null;
}

/**
 * บันทึกข้อความ + ผูกไฟล์ที่อัปไว้ — ไฟล์ต้องเป็นของคนส่งและยังไม่ถูกผูกกับข้อความอื่น
 * (กันเอา id ไฟล์ของคนอื่นมาแนบ หรือย้ายไฟล์จากห้อง DM ไปห้องอื่น)
 */
export function addMessage(m: {
  room: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  fileIds: string[];
  /** id ข้อความที่ตอบกลับ — ต้องอยู่ห้องเดียวกัน (route เช็คก่อนแล้ว เช็คซ้ำในนี้อีกชั้น) */
  replyTo?: number | null;
}): TeamMessage {
  return db.transaction(() => {
    const files = m.fileIds.map((id) => {
      const f = db.prepare("SELECT * FROM team_files WHERE id = ?").get(id) as TeamFileRow | undefined;
      if (!f || f.uploader_id !== m.authorId || f.message_id !== null) {
        throw new Error("ไฟล์แนบไม่ถูกต้อง");
      }
      return f;
    });
    const replyTo = m.replyTo ?? null;
    if (replyTo !== null && !getReplyTarget(m.room, replyTo)) throw new Error("ไม่พบข้อความที่จะตอบกลับ");
    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO team_messages (room, author_id, author_name, body, mentions, created_at, reply_to)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.room, m.authorId, m.authorName, m.body, JSON.stringify(m.mentions), now, replyTo);
    const id = Number(info.lastInsertRowid);
    for (const f of files) {
      db.prepare("UPDATE team_files SET message_id = ? WHERE id = ?").run(id, f.id);
    }
    markRead(m.authorId, m.room, id);
    return {
      id,
      room: m.room,
      authorId: m.authorId,
      authorName: m.authorName,
      body: m.body,
      mentions: m.mentions,
      createdAt: now,
      files: files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size })),
      replyTo: replyTo === null ? null : (replyRefs([replyTo]).get(replyTo) ?? null),
    };
  })();
}

/** ข้อความในห้อง — after = ดึงเฉพาะที่ใหม่กว่า id นี้ (poll), before = ย้อนดูของเก่า */
export function listMessages(
  room: string,
  opts: { after?: number; before?: number; limit?: number } = {},
): TeamMessage[] {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const rows = (
    opts.after !== undefined
      ? db
          .prepare("SELECT * FROM team_messages WHERE room = ? AND id > ? ORDER BY id ASC LIMIT ?")
          .all(room, opts.after, limit)
      : db
          .prepare(
            "SELECT * FROM team_messages WHERE room = ? AND id < ? ORDER BY id DESC LIMIT ?",
          )
          .all(room, opts.before ?? Number.MAX_SAFE_INTEGER, limit)
          .reverse()
  ) as MsgRow[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const files = db
    .prepare(
      `SELECT * FROM team_files WHERE message_id IN (${ids.map(() => "?").join(",")}) ORDER BY rowid`,
    )
    .all(...ids) as TeamFileRow[];
  const replies = replyRefs([...new Set(rows.map((r) => r.reply_to).filter((x): x is number => x !== null))]);
  return rows.map((r) => ({
    id: r.id,
    room: r.room,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    mentions: JSON.parse(r.mentions) as string[],
    createdAt: r.created_at,
    files: files
      .filter((f) => f.message_id === r.id)
      .map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size })),
    replyTo: r.reply_to === null ? null : (replies.get(r.reply_to) ?? null),
  }));
}

export function markRead(userId: string, room: string, lastId: number): void {
  db.prepare(
    `INSERT INTO team_reads (user_id, room, last_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, room) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`,
  ).run(userId, room, lastId);
}

export interface RoomSummary {
  room: string;
  unread: number;
  mentioned: boolean;
  lastId: number;
  lastAt: number | null;
  lastText: string | null;
}

/**
 * สรุปทุกห้องที่ผู้ใช้คนนี้อยู่ — ยังไม่อ่านกี่ข้อความ, โดนแท็กไหม, ข้อความล่าสุด
 * ข้อความของตัวเองไม่นับเป็น "ยังไม่อ่าน"
 */
export function roomSummaries(userId: string): RoomSummary[] {
  const rows = db
    .prepare(
      `SELECT m.room,
              MAX(m.id) AS lastId,
              SUM(CASE WHEN m.id > COALESCE(r.last_id, 0) AND m.author_id <> @me THEN 1 ELSE 0 END) AS unread,
              MAX(CASE WHEN m.id > COALESCE(r.last_id, 0) AND m.author_id <> @me
                        AND EXISTS (SELECT 1 FROM json_each(m.mentions) j WHERE j.value = @me)
                       THEN 1 ELSE 0 END) AS mentioned
       FROM team_messages m
       LEFT JOIN team_reads r ON r.user_id = @me AND r.room = m.room
       WHERE m.room = 'general' OR m.room LIKE @dmA OR m.room LIKE @dmB
       GROUP BY m.room`,
    )
    .all({ me: userId, dmA: `dm:${userId}:%`, dmB: `dm:%:${userId}` }) as {
    room: string;
    lastId: number;
    unread: number;
    mentioned: number;
  }[];
  const last = db.prepare("SELECT body, created_at FROM team_messages WHERE id = ?");
  return rows
    .filter((r) => canAccessRoom(r.room, userId))
    .map((r) => {
      const l = last.get(r.lastId) as { body: string; created_at: number } | undefined;
      return {
        room: r.room,
        unread: r.unread,
        mentioned: r.mentioned === 1,
        lastId: r.lastId,
        lastAt: l?.created_at ?? null,
        lastText: l ? l.body.slice(0, 80) : null,
      };
    });
}

/** ลบข้อความ/ไฟล์ที่เก่าเกิน 90 วัน + ไฟล์ที่อัปค้างไม่ได้ส่ง — คืนจำนวน (ข้อความ, ไฟล์) */
export function pruneTeamChat(now = Date.now()): { messages: number; files: number } {
  const cutoff = now - RETENTION_MS;
  const stale = db
    .prepare(
      `SELECT f.id FROM team_files f LEFT JOIN team_messages m ON m.id = f.message_id
       WHERE (f.message_id IS NULL AND f.created_at < ?) OR (m.created_at < ?)
          OR (f.message_id IS NOT NULL AND m.id IS NULL)`,
    )
    .all(now - ORPHAN_MS, cutoff) as { id: string }[];
  for (const f of stale) {
    rmSync(filePath(f.id), { force: true });
    db.prepare("DELETE FROM team_files WHERE id = ?").run(f.id);
  }
  const messages = db.prepare("DELETE FROM team_messages WHERE created_at < ?").run(cutoff).changes;
  return { messages, files: stale.length };
}

export const isSnowflake = (id: unknown): id is string =>
  typeof id === "string" && SNOWFLAKE.test(id);
