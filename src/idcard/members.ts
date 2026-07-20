import { db } from "../store/db.js";

/**
 * เก็บข้อมูลสมาชิก/บัตร (พอร์ตจาก data_manager.py)
 * ตาราง members ใน data/bot.db — member_number เดินเลขต่อเนื่อง (MAX+1)
 */

export interface MemberCard {
  member_number: number;
  join_date: string; // dd/mm/yyyy
  bias: string;
  status: string;
}

type MemberRow = MemberCard & { user_id: string };

function formatDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function rowToCard(row: MemberRow): MemberCard {
  return {
    member_number: row.member_number,
    join_date: row.join_date,
    bias: row.bias,
    status: row.status,
  };
}

/** ลงทะเบียนสมาชิก (ถ้ามีแล้วคืนของเดิม) */
export const registerMember = db.transaction(
  (
    userId: string,
    joinedAt: Date | null,
    bias = "-",
    status = "-",
  ): MemberCard => {
    const existing = db
      .prepare("SELECT * FROM members WHERE user_id = ?")
      .get(userId) as MemberRow | undefined;
    if (existing) return rowToCard(existing);

    const next =
      (
        db.prepare("SELECT MAX(member_number) AS n FROM members").get() as {
          n: number | null;
        }
      ).n ?? 0;
    const member: MemberCard = {
      member_number: next + 1,
      join_date: formatDate(joinedAt ?? new Date()),
      bias,
      status,
    };
    db.prepare(
      `INSERT INTO members (user_id, member_number, join_date, bias, status)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      userId,
      member.member_number,
      member.join_date,
      member.bias,
      member.status,
    );
    return member;
  },
) as (
  userId: string,
  joinedAt: Date | null,
  bias?: string,
  status?: string,
) => MemberCard;

/** อัปเดต bias/status — คืน null ถ้ายังไม่ลงทะเบียน */
export function updateMember(
  userId: string,
  patch: Partial<Pick<MemberCard, "bias" | "status">>,
): MemberCard | null {
  const current = getMember(userId);
  if (!current) return null;
  const next = { ...current, ...patch };
  db.prepare("UPDATE members SET bias = ?, status = ? WHERE user_id = ?").run(
    next.bias,
    next.status,
    userId,
  );
  return next;
}

export function getMember(userId: string): MemberCard | null {
  const row = db
    .prepare("SELECT * FROM members WHERE user_id = ?")
    .get(userId) as MemberRow | undefined;
  return row ? rowToCard(row) : null;
}

/** รายชื่อสมาชิกทั้งหมด (เรียงตามหมายเลข) สำหรับหน้าเว็บ */
export function listMembers(): (MemberCard & { id: string })[] {
  const rows = db
    .prepare("SELECT * FROM members ORDER BY member_number")
    .all() as MemberRow[];
  return rows.map((r) => ({ id: r.user_id, ...rowToCard(r) }));
}

export function memberCount(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM members").get() as { n: number }
  ).n;
}
