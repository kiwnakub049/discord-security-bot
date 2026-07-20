import { db } from "../store/db.js";

/**
 * DB layer สำหรับเก็บสถานะ "ห้องเสียงที่ถูกล็อก" — ตาราง voice_locks ใน data/bot.db
 * เก็บใน DB (ไม่ใช่ in-memory) เพื่อให้บอท restart แล้วยังรู้ว่าห้องไหนล็อกอยู่
 *
 * แนวคิด "delta": การล็อกแก้แค่ bit Connect เท่านั้น ดังนั้นเราเก็บแค่
 * "สถานะ Connect เดิม" ของแต่ละ overwrite ก่อนล็อก แล้วตอน unlock ก็คืนเฉพาะ Connect
 * — ไม่ไปแตะ permission อื่น ๆ (ปลอดภัยกว่า snapshot ทั้ง bitfield ที่อาจ poison ได้)
 */

/** สถานะ Connect ที่เป็นไปได้ของ overwrite 1 อัน */
export type ConnectState = "allow" | "deny" | "neutral";

/** สถานะ Connect เดิมของ overwrite 1 อัน ก่อนถูกล็อก */
export interface ConnectSnapshot {
  id: string; // role id หรือ member id
  type: number; // OverwriteType: 0 = role, 1 = member
  prevConnect: ConnectState; // ค่า Connect เดิมที่ต้องคืนตอน unlock
}

export interface VoiceLock {
  channelId: string;
  lockedBy: string;
  lockedAt: number;
  overwrites: ConnectSnapshot[];
}

/** interface ของ DB layer — สลับ implementation ได้โดยไม่แตะ command/listener */
export interface VoiceLockDB {
  get(channelId: string): VoiceLock | null;
  set(lock: VoiceLock): void;
  delete(channelId: string): void;
  isLocked(channelId: string): boolean;
}

type LockRow = {
  channel_id: string;
  locked_by: string;
  locked_at: number;
  overwrites: string;
};

/** implementation บน SQLite */
class SqliteVoiceLockDB implements VoiceLockDB {
  get(channelId: string): VoiceLock | null {
    const row = db
      .prepare("SELECT * FROM voice_locks WHERE channel_id = ?")
      .get(channelId) as LockRow | undefined;
    if (!row) return null;
    return {
      channelId: row.channel_id,
      lockedBy: row.locked_by,
      lockedAt: row.locked_at,
      overwrites: JSON.parse(row.overwrites) as ConnectSnapshot[],
    };
  }

  set(lock: VoiceLock): void {
    db.prepare(
      `INSERT INTO voice_locks (channel_id, locked_by, locked_at, overwrites)
       VALUES (@channelId, @lockedBy, @lockedAt, @overwrites)
       ON CONFLICT(channel_id) DO UPDATE SET
         locked_by = @lockedBy, locked_at = @lockedAt, overwrites = @overwrites`,
    ).run({
      channelId: lock.channelId,
      lockedBy: lock.lockedBy,
      lockedAt: lock.lockedAt,
      overwrites: JSON.stringify(lock.overwrites),
    });
  }

  delete(channelId: string): void {
    db.prepare("DELETE FROM voice_locks WHERE channel_id = ?").run(channelId);
  }

  isLocked(channelId: string): boolean {
    const row = db
      .prepare("SELECT 1 FROM voice_locks WHERE channel_id = ?")
      .get(channelId);
    return row !== undefined;
  }
}

export const voiceLockDB: VoiceLockDB = new SqliteVoiceLockDB();
