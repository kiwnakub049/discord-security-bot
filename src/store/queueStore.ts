import { db } from "./db.js";

/**
 * คิวงานที่รอ mod ตัดสินใจ
 *
 * ใครจะส่งเรื่องเข้าคิวก็เรียก enqueue() — เช่น anti-raid เจอบัญชีน่าสงสัย,
 * คำสั่ง /ticket ของสมาชิก, หรือโมดูลที่อยากให้คนกดยืนยันก่อนแบนจริง
 * หน้าแรกของ dashboard อ่านจากตารางนี้ตารางเดียว
 */

export interface QueueRow {
  id: number;
  category: string;
  subject_id: string | null;
  title: string;
  detail: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  outcome: string | null;
}

const findOpen = db.prepare(
  `SELECT * FROM queue_items
    WHERE resolved_at IS NULL AND category = ? AND subject_id = ?`,
);
const insert = db.prepare(
  `INSERT INTO queue_items (category, subject_id, title, detail, created_at)
   VALUES (@category, @subject_id, @title, @detail, @created_at)`,
);

/**
 * ส่งเรื่องเข้าคิว — คืน id ของแถว
 *
 * ถ้ามีเรื่องที่ยังค้างอยู่ในหมวดเดียวกันของคนเดียวกันแล้ว จะไม่สร้างซ้ำ
 * (anti-raid อาจจับบัญชีเดิมได้หลายรอบ ไม่ควรกลายเป็นการ์ดซ้อนกันห้าใบของคนคนเดียว)
 */
export function enqueue(item: {
  category: string;
  subjectId?: string | null;
  title: string;
  detail?: string | null;
  at?: number;
}): number {
  const subject = item.subjectId ?? null;
  if (subject) {
    const open = findOpen.get(item.category, subject) as QueueRow | undefined;
    if (open) return open.id;
  }
  const info = insert.run({
    category: item.category,
    subject_id: subject,
    title: item.title,
    detail: item.detail ?? null,
    created_at: item.at ?? Date.now(),
  });
  return Number(info.lastInsertRowid);
}

/** สรุปต่อหมวด: จำนวนที่ค้าง + เวลาของเรื่องที่รอนานที่สุด */
export function openSummary(): { category: string; count: number; oldestAt: number }[] {
  return db
    .prepare(
      `SELECT category, COUNT(*) AS count, MIN(created_at) AS oldestAt
         FROM queue_items WHERE resolved_at IS NULL
        GROUP BY category`,
    )
    .all() as { category: string; count: number; oldestAt: number }[];
}

/** เรื่องที่ค้างในหมวด เก่าสุดก่อน (คิวคือมาก่อนได้ก่อน) */
export function listOpen(category: string, limit = 100): QueueRow[] {
  return db
    .prepare(
      `SELECT * FROM queue_items
        WHERE resolved_at IS NULL AND category = ?
        ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .all(category, limit) as QueueRow[];
}

export function getItem(id: number): QueueRow | undefined {
  return db.prepare("SELECT * FROM queue_items WHERE id = ?").get(id) as QueueRow | undefined;
}

/**
 * ปิดเรื่องที่ค้างของคนคนหนึ่งในหมวดหนึ่ง (ถ้ามี) — คืน true ถ้ามีเรื่องถูกปิดจริง
 *
 * ใช้ตอนที่ระบบรู้ผลเองโดยไม่ต้องรอ mod เช่น สมาชิกออกจากเซิร์ฟไปก่อน
 * หรือบอทเตะทิ้งไปแล้วตอน raid — ปล่อยไว้ mod จะเปิดมาเจอการ์ดของคนที่ไม่อยู่แล้ว
 */
export function resolveOpenFor(
  category: string,
  subjectId: string,
  outcome: string,
  by: string,
): boolean {
  const open = findOpen.get(category, subjectId) as QueueRow | undefined;
  return open ? resolve(open.id, outcome, by) : false;
}

/**
 * ปิดเรื่อง — คืน false ถ้าเรื่องนี้ถูกปิดไปแล้ว
 *
 * เช็ค resolved_at IS NULL ใน WHERE เอง เพื่อกันสอง mod กดพร้อมกันแล้วต่างคนต่างคิดว่าตัวเองตัดสิน
 */
export function resolve(id: number, outcome: string, by: string): boolean {
  return (
    db
      .prepare(
        `UPDATE queue_items SET resolved_at = ?, resolved_by = ?, outcome = ?
          WHERE id = ? AND resolved_at IS NULL`,
      )
      .run(Date.now(), by, outcome, id).changes > 0
  );
}
