import { db } from "../store/db.js";

/**
 * ทะเบียนการลงโทษ "ไมค์แดง" (server mute) จากระบบเตือน — ตาราง mute_punishments
 *
 * เก็บใน DB เพราะ Discord server mute ไม่มีตัวจับเวลาในตัว บอทต้องรู้ว่าใครโดนถึง
 * เมื่อไหร่ เพื่อ (1) ปลดให้เองเมื่อครบเวลา และ (2) ปิดกลับทันทีถ้ามีคนไปปลดก่อนเวลา
 * ต้องรอด restart ด้วย ไม่งั้นบอทดับแล้วโทษหาย/ค้าง
 */

export interface MutePunishment {
  userId: string;
  guildId: string;
  until: number; // ปลดเมื่อ epoch ms นี้
  reason: string;
}

type Row = {
  user_id: string;
  guild_id: string;
  until: number;
  reason: string;
};

function rowTo(r: Row): MutePunishment {
  return { userId: r.user_id, guildId: r.guild_id, until: r.until, reason: r.reason };
}

/** เริ่ม/ต่ออายุการลงโทษของคนนี้ (ทับของเดิมถ้ามี) */
export function setMutePunishment(p: MutePunishment): void {
  db.prepare(
    `INSERT INTO mute_punishments (user_id, guild_id, until, reason)
     VALUES (@userId, @guildId, @until, @reason)
     ON CONFLICT(user_id) DO UPDATE SET
       guild_id = @guildId, until = @until, reason = @reason`,
  ).run(p);
  // โทษรอบใหม่ทับรายการค้างปลดของรอบก่อน — ไม่งั้นรายการเก่าจะไปปลดไมค์ตอนที่ไม่ควรปลด
  clearReleasePending(p.userId);
}

/** การลงโทษที่ "ยังไม่หมดเวลา" ของคนนี้ — null ถ้าไม่โดนอยู่/หมดเวลาแล้ว */
export function getActiveMute(userId: string): MutePunishment | null {
  const row = db
    .prepare("SELECT * FROM mute_punishments WHERE user_id = ? AND until > ?")
    .get(userId, Date.now()) as Row | undefined;
  return row ? rowTo(row) : null;
}

/** รายการที่ยังไม่หมดเวลา (ใช้ seed ตอนบอทออนไลน์) */
export function listActiveMutes(): MutePunishment[] {
  return (
    db
      .prepare("SELECT * FROM mute_punishments WHERE until > ?")
      .all(Date.now()) as Row[]
  ).map(rowTo);
}

/** รายการที่หมดเวลาแล้ว รอปลด (ใช้ในลูปตรวจครบกำหนด) */
export function listExpiredMutes(): MutePunishment[] {
  return (
    db
      .prepare("SELECT * FROM mute_punishments WHERE until <= ?")
      .all(Date.now()) as Row[]
  ).map(rowTo);
}

export function clearMutePunishment(userId: string): void {
  db.prepare("DELETE FROM mute_punishments WHERE user_id = ?").run(userId);
}

/* ─── ค้างปลด: ครบเวลาหรือสั่งปลดตอนคนนั้นอยู่นอกห้องเสียง ─── */

export function markReleasePending(userId: string, guildId: string, reason: string): void {
  db.prepare(
    `INSERT INTO mute_release_pending (user_id, guild_id, reason, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET guild_id = excluded.guild_id,
       reason = excluded.reason, created_at = excluded.created_at`,
  ).run(userId, guildId, reason, Date.now());
}

export function getReleasePending(userId: string): { guildId: string; reason: string } | null {
  const row = db
    .prepare("SELECT guild_id, reason FROM mute_release_pending WHERE user_id = ?")
    .get(userId) as { guild_id: string; reason: string } | undefined;
  return row ? { guildId: row.guild_id, reason: row.reason } : null;
}

export function listReleasePending(): { userId: string; guildId: string; reason: string }[] {
  return (
    db.prepare("SELECT user_id, guild_id, reason FROM mute_release_pending").all() as {
      user_id: string;
      guild_id: string;
      reason: string;
    }[]
  ).map((r) => ({ userId: r.user_id, guildId: r.guild_id, reason: r.reason }));
}

export function clearReleasePending(userId: string): void {
  db.prepare("DELETE FROM mute_release_pending WHERE user_id = ?").run(userId);
}
