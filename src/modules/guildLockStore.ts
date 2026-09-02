import { db } from "../store/db.js";

/**
 * DB layer สำหรับ lockdown ทั้งเซิร์ฟเวอร์ — ตาราง guild_locks ใน data/bot.db
 *
 * ต่างจาก voiceLockStore ตรงที่ lockdown แตะหลาย permission (ไม่ใช่แค่ Connect)
 * และแตะเฉพาะ @everyone ของแต่ละห้อง เก็บใน DB เพื่อให้ restart แล้วยังปลดล็อก
 * คืนค่าเดิมได้ถูกต้อง
 *
 * แนวคิด "delta" เหมือน voiceLock: เก็บแค่สถานะเดิมของ permission ที่เราจะแตะ
 * (true=allow, false=deny, null=neutral) ก่อนตั้งเป็น deny ตอนล็อก แล้วคืนค่านี้
 * ตอนปลด — ไม่ไปยุ่ง permission อื่นของ @everyone
 */

/** สถานะ permission 1 บิตบน overwrite: allow / deny / neutral */
export type PermState = boolean | null;

/** สถานะเดิมของทุก permission ที่ lockdown แตะ (key = ชื่อ permission ของ discord.js) */
export type LockPermSnapshot = Record<string, PermState>;

export interface GuildLock {
  channelId: string;
  guildId: string;
  lockedAt: number;
  perms: LockPermSnapshot;
}

type LockRow = {
  channel_id: string;
  guild_id: string;
  locked_at: number;
  perms: string;
};

function rowToLock(row: LockRow): GuildLock {
  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    lockedAt: row.locked_at,
    perms: JSON.parse(row.perms) as LockPermSnapshot,
  };
}

export const guildLockDB = {
  get(channelId: string): GuildLock | null {
    const row = db
      .prepare("SELECT * FROM guild_locks WHERE channel_id = ?")
      .get(channelId) as LockRow | undefined;
    return row ? rowToLock(row) : null;
  },

  /**
   * บันทึก snapshot — เขียนเฉพาะเมื่อห้องนี้ยังไม่มี snapshot ค้างอยู่ (INSERT OR IGNORE)
   * ป้องกัน "snapshot poison": ถ้าสั่งล็อกซ้ำห้องที่ถูกล็อกอยู่แล้ว จะได้ไม่ไปเก็บ
   * สถานะ "deny" ที่เราตั้งเองรอบก่อนมาเป็น "ค่าเดิม" ทับของจริง
   */
  set(lock: GuildLock): void {
    db.prepare(
      `INSERT OR IGNORE INTO guild_locks (channel_id, guild_id, locked_at, perms)
       VALUES (@channelId, @guildId, @lockedAt, @perms)`,
    ).run({
      channelId: lock.channelId,
      guildId: lock.guildId,
      lockedAt: lock.lockedAt,
      perms: JSON.stringify(lock.perms),
    });
  },

  delete(channelId: string): void {
    db.prepare("DELETE FROM guild_locks WHERE channel_id = ?").run(channelId);
  },

  isLocked(channelId: string): boolean {
    return (
      db
        .prepare("SELECT 1 FROM guild_locks WHERE channel_id = ?")
        .get(channelId) !== undefined
    );
  },
};
