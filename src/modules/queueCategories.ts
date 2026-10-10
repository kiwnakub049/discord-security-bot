/**
 * หมวดของคิวรอดำเนินการ — จุดเดียวที่ต้องแก้เวลาเพิ่มหมวดใหม่
 *
 * หน้าเว็บไม่ได้ฝังรายชื่อหมวดไว้เอง มันวาดทุกอย่างจากข้อมูลที่ /api/queue ส่งไป
 * (ชื่อ ความรุนแรง ปุ่มที่กดได้) เพิ่มหมวดตรงนี้ + ให้โมดูลเรียก enqueue() = การ์ดโผล่เอง
 *
 * ไฟล์นี้ไม่ import อะไรเลย เทสเรียกตรวจได้ตรง ๆ
 */

export type QueueSeverity = "alert" | "warn" | "info";

export interface QueueOutcome {
  /** ค่าที่บันทึกลง queue_items.outcome */
  key: string;
  /** ข้อความบนปุ่ม — บอกว่ากดแล้วเกิดอะไร ไม่ใช่ "ตกลง" */
  label: string;
  tone: "danger" | "accent" | "plain";
  /** ข้อความตอบกลับหลังทำสำเร็จ (ขึ้นใน toast) */
  doneText: string;
  /** ผลข้างเคียงที่เซิร์ฟเวอร์ต้องทำจริงก่อนปิดเรื่อง */
  effect?: "ban";
}

export interface QueueCategoryDef {
  key: string;
  label: string;
  severity: QueueSeverity;
  /** รอนานเกินนี้ (นาที) = เวลารอขึ้นสีแดงบนการ์ด */
  overdueAfterMin: number;
  /** กริยาบนปุ่มของกอง เช่น "ตรวจการแบน" → "ตรวจการแบน 3 ราย" */
  verb: string;
  /** ลักษณนามของรายการในหมวดนี้ */
  unit: string;
  outcomes: QueueOutcome[];
}

export const QUEUE_CATEGORIES: QueueCategoryDef[] = [
  {
    key: "ban-approval",
    label: "รอยืนยันแบน",
    severity: "alert",
    overdueAfterMin: 30,
    verb: "ตรวจการแบน",
    unit: "ราย",
    outcomes: [
      { key: "approve", label: "ยืนยันแบน", tone: "danger", doneText: "แบนแล้ว", effect: "ban" },
      { key: "dismiss", label: "ไม่แบน", tone: "plain", doneText: "ยกเลิกคำขอแบนแล้ว" },
    ],
  },
  {
    key: "suspicious-member",
    label: "สมาชิกใหม่น่าสงสัย",
    severity: "warn",
    overdueAfterMin: 60,
    verb: "ตรวจบัญชี",
    unit: "บัญชี",
    outcomes: [
      { key: "ban", label: "แบน", tone: "danger", doneText: "แบนแล้ว", effect: "ban" },
      { key: "clear", label: "ปกติ ปล่อยผ่าน", tone: "plain", doneText: "ปล่อยผ่านแล้ว" },
    ],
  },
  {
    key: "admin-ticket",
    label: "Ticket แอดมิน",
    severity: "info",
    overdueAfterMin: 24 * 60,
    verb: "เปิด ticket",
    unit: "เรื่อง",
    outcomes: [{ key: "done", label: "ปิด ticket", tone: "accent", doneText: "ปิด ticket แล้ว" }],
  },
];

const BY_KEY = new Map(QUEUE_CATEGORIES.map((c) => [c.key, c]));

export const categoryDef = (key: string): QueueCategoryDef | undefined => BY_KEY.get(key);

const SEVERITY_RANK: Record<QueueSeverity, number> = { alert: 0, warn: 1, info: 2 };

/**
 * ลำดับกองบนหน้าแรก: เกินเวลาก่อน → รุนแรงกว่าก่อน → รอนานกว่าก่อน
 *
 * "เกินเวลา" มาก่อนความรุนแรง เพราะ ticket ที่ค้างมาสองวันควรแซงคำขอแบน
 * ที่เพิ่งเข้ามาเมื่อนาทีที่แล้ว — ไม่งั้นหมวดเบาจะไม่เคยได้ขึ้นมาเป็นใบแรกเลย
 */
export function compareStacks(
  a: { severity: QueueSeverity; oldestAt: number; overdueAfterMin: number },
  b: { severity: QueueSeverity; oldestAt: number; overdueAfterMin: number },
  now: number,
): number {
  const over = (s: typeof a) => now - s.oldestAt > s.overdueAfterMin * 60_000;
  const oa = over(a);
  const ob = over(b);
  if (oa !== ob) return oa ? -1 : 1;
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;
  return a.oldestAt - b.oldestAt;
}
