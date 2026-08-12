import { db } from "./db.js";

/**
 * เก็บคำตัดสินของ mod ต่อสิ่งที่ AI classifier จับได้
 *
 * ทำไมต้องมี: โซน review ของ aiMod ขึ้น log ให้ mod ดู แต่เดิม "ผลตัดสิน" ไม่ได้ถูกเก็บไว้ที่ไหนเลย
 * เรารู้แค่ว่า AI คิดอะไร ไม่รู้ว่าคนเห็นด้วยไหม ซึ่งเป็นครึ่งที่ขาดไม่ได้ถ้าจะเทรนรอบหน้า
 *
 * verdict:
 *   'toxic' = AI จับถูก ข้อความนี้ toxic จริง
 *   'ok'    = AI จับผิดตัว ข้อความนี้ปกติ
 */

export type Verdict = "toxic" | "ok";

export interface VerdictRow {
  log_id: number;
  verdict: Verdict;
  score: number;
  zone: string;
  text: string;
  user_id: string;
  decided_by: string;
  decided_at: number;
}

const upsert = db.prepare(
  `INSERT INTO ai_verdicts (log_id, verdict, score, zone, text, user_id, decided_by, decided_at)
   VALUES (@log_id, @verdict, @score, @zone, @text, @user_id, @decided_by, @decided_at)
   ON CONFLICT(log_id) DO UPDATE SET
     verdict    = excluded.verdict,
     decided_by = excluded.decided_by,
     decided_at = excluded.decided_at`,
);

/** บันทึก/แก้คำตัดสิน — กดซ้ำด้วยค่าใหม่ = เปลี่ยนใจได้ ไม่สร้างแถวซ้ำ */
export function setVerdict(row: Omit<VerdictRow, "decided_at">): void {
  upsert.run({ ...row, decided_at: Date.now() });
}

/** ลบคำตัดสิน (กดปุ่มเดิมซ้ำ = ยกเลิกที่เคยตัดสินไว้) */
export function clearVerdict(logId: number): boolean {
  return db.prepare("DELETE FROM ai_verdicts WHERE log_id = ?").run(logId).changes > 0;
}

/** คืน map ของ logId -> verdict ให้หน้าเว็บรู้ว่าอันไหนตัดสินไปแล้ว */
export function getVerdictMap(): Record<number, Verdict> {
  const rows = db
    .prepare("SELECT log_id, verdict FROM ai_verdicts")
    .all() as { log_id: number; verdict: Verdict }[];
  const out: Record<number, Verdict> = {};
  for (const r of rows) out[r.log_id] = r.verdict;
  return out;
}

/** ทุกคำตัดสิน เรียงเก่า -> ใหม่ (ใช้ตอน export เป็นชุดเทรน) */
export function getAllVerdicts(): VerdictRow[] {
  return db
    .prepare("SELECT * FROM ai_verdicts ORDER BY decided_at ASC")
    .all() as VerdictRow[];
}

/** สรุปจำนวน — ใช้โชว์ว่าสะสม label ได้เท่าไหร่แล้ว และ AI แม่นแค่ไหน */
export function verdictStats(): {
  total: number;
  toxic: number;
  ok: number;
  precision: number | null;
} {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN verdict = 'toxic' THEN 1 ELSE 0 END) AS toxic
         FROM ai_verdicts`,
    )
    .get() as { total: number; toxic: number | null };
  const total = r.total ?? 0;
  const toxic = r.toxic ?? 0;
  return {
    total,
    toxic,
    ok: total - toxic,
    // สัดส่วนที่ AI จับถูก จากทั้งหมดที่ mod ตัดสินแล้ว (ยังไม่ตัดสิน = ไม่นับ)
    precision: total ? toxic / total : null,
  };
}
