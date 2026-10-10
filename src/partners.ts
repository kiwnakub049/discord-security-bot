/**
 * ทะเบียนบอทของพาร์ทเนอร์ — บอทจากเซิร์ฟเวอร์อื่นที่เราอนุญาตให้เข้ามาจัดการในนี้
 *
 * ทำไมต้องมี: บอทพวกนี้ทำงานถี่มาก (Kill Switch แบนไปแล้ว 70+ ครั้ง) ถ้าปล่อยให้
 * ปนอยู่ในหมวด "ตรวจสอบ" รวมกับการกระทำของ mod คนจริง จะกลายเป็นว่าเปิดหน้านั้น
 * มาแล้วเห็นแต่งานของบอท หาเรื่องที่คนทำไม่เจอ
 *
 * อีกเรื่องคือ Discord ส่ง audit log มาโดยที่ resolve ชื่อบอทไม่ได้ (executor เป็น null)
 * หน้าเว็บเลยขึ้นเป็นเลข 19 หลักเปล่า ๆ ซึ่งอ่านไม่รู้เรื่องว่าใครทำ
 * ทะเบียนนี้แก้ทั้งสองเรื่องพร้อมกัน
 */

export interface PartnerBot {
  /** Discord user id ของบอท */
  id: string;
  /** ชื่อที่จะโชว์แทนเลข id */
  name: string;
  /** ทำอะไร — ขึ้นเป็นคำอธิบายในหน้าเว็บ */
  role: string;
}

export const PARTNER_BOTS: readonly PartnerBot[] = [
  {
    id: "1292549208846372875",
    name: "Kill Switch",
    role: "บอทแบนมิจ",
  },
];

const BY_ID = new Map(PARTNER_BOTS.map((p) => [p.id, p]));

/** หาบอทพาร์ทเนอร์จาก id ตรง ๆ */
export function partnerById(id: string | null | undefined): PartnerBot | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/**
 * หาบอทพาร์ทเนอร์จากค่าในช่อง "ผู้ทำ" ของ log
 *
 * ค่านั้นมีได้สองรูปแบบ แล้วแต่ว่าตอนบันทึก resolve ชื่อได้หรือไม่:
 *   "ชื่อ#1234 (1292549208846372875)"  ← resolve ได้
 *   "1292549208846372875"              ← resolve ไม่ได้ เหลือแต่ id
 * ต้องรับทั้งสองแบบ ไม่งั้นการย้ายข้อมูลเก่าจะพลาดครึ่งหนึ่ง
 */
export function partnerFromActor(value: string): PartnerBot | null {
  const inParens = /\((\d{5,})\)\s*$/.exec(value)?.[1];
  return partnerById(inParens ?? value.trim());
}

/** ข้อความที่ใช้แทนค่าเดิมในช่อง "ผู้ทำ" — เก็บ id ไว้ด้วยเพื่อตรวจสอบย้อนหลังได้ */
export function partnerLabel(bot: PartnerBot): string {
  return `${bot.name} (${bot.id})`;
}
