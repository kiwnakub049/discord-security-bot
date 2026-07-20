import { db } from "../store/db.js";

/**
 * เก็บประวัติการเตือนสมาชิก — ตาราง warnings ใน data/bot.db
 */

export interface Warning {
  id: number;
  reason: string;
  moderatorId: string;
  moderatorTag: string;
  timestamp: number;
}

type WarningRow = {
  id: number;
  user_id: string;
  reason: string;
  moderator_id: string;
  moderator_tag: string;
  timestamp: number;
};

function rowToWarning(r: WarningRow): Warning {
  return {
    id: r.id,
    reason: r.reason,
    moderatorId: r.moderator_id,
    moderatorTag: r.moderator_tag,
    timestamp: r.timestamp,
  };
}

/** เพิ่มเตือน คืนรายการเตือนปัจจุบัน + จำนวนรวม */
export const addWarning = db.transaction(
  (
    userId: string,
    moderatorId: string,
    moderatorTag: string,
    reason: string,
  ): { warning: Warning; count: number } => {
    const info = db
      .prepare(
        `INSERT INTO warnings (user_id, reason, moderator_id, moderator_tag, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, reason, moderatorId, moderatorTag, Date.now());
    const warning: Warning = {
      id: Number(info.lastInsertRowid),
      reason,
      moderatorId,
      moderatorTag,
      timestamp: Date.now(),
    };
    const count = (
      db
        .prepare("SELECT COUNT(*) AS n FROM warnings WHERE user_id = ?")
        .get(userId) as { n: number }
    ).n;
    return { warning, count };
  },
) as (
  userId: string,
  moderatorId: string,
  moderatorTag: string,
  reason: string,
) => { warning: Warning; count: number };

export function getWarnings(userId: string): Warning[] {
  const rows = db
    .prepare("SELECT * FROM warnings WHERE user_id = ? ORDER BY id")
    .all(userId) as WarningRow[];
  return rows.map(rowToWarning);
}

/** จำนวนเตือนรวมทั้งเซิร์ฟเวอร์ (สำหรับหน้าภาพรวม) */
export function totalWarnings(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM warnings").get() as { n: number }
  ).n;
}

/** รายชื่อคนที่มีเตือน + จำนวน (เรียงมาก→น้อย) */
export function membersWithWarnings(): { userId: string; count: number }[] {
  const rows = db
    .prepare(
      `SELECT user_id, COUNT(*) AS count FROM warnings
       GROUP BY user_id ORDER BY count DESC`,
    )
    .all() as { user_id: string; count: number }[];
  return rows.map((r) => ({ userId: r.user_id, count: r.count }));
}

/** ล้างเตือนทั้งหมดของ user คืนจำนวนที่ลบ */
export function clearWarnings(userId: string): number {
  const info = db
    .prepare("DELETE FROM warnings WHERE user_id = ?")
    .run(userId);
  return info.changes;
}
