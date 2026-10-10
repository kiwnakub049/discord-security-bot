import type { Client } from "discord.js";
import { enqueue, openItemFor, type QueueRow } from "../store/queueStore.js";

/**
 * Ticket ถึงแอดมิน — สมาชิกเปิดเรื่องผ่าน /ticket แล้วไปรอในคิวบน dashboard
 * โมดูลนี้ไม่รู้จักหน้าเว็บ: แค่ส่งเรื่องเข้าคิว และแจ้งสมาชิกเมื่อมีคนปิดเรื่อง
 */

/** หมวดคิว — ต้องตรงกับ key ใน queueCategories */
export const TICKET_CATEGORY = "admin-ticket";

/**
 * เปิด ticket — created = false แปลว่าคนนี้มี ticket ค้างอยู่แล้ว (ได้ id ของเรื่องเดิมกลับมา)
 *
 * จำกัดคนละ 1 เรื่องที่ค้าง: กันสมาชิกกดซ้ำรัว ๆ ตอนรอนานจนคิวเต็มไปด้วยเรื่องเดียวกัน
 * ตัวกันซ้ำอยู่ใน enqueue() แล้ว ที่นี่แค่ดูว่า id ที่ได้คืนเป็นของเรื่องที่ค้างอยู่ก่อนหรือเปล่า
 */
export function openTicket(
  userId: string,
  topic: string,
  detail: string,
): { id: number; created: boolean } {
  const existing = openItemFor(TICKET_CATEGORY, userId);
  const id = enqueue({ category: TICKET_CATEGORY, subjectId: userId, title: topic, detail });
  return { id, created: id !== existing?.id };
}

/**
 * แจ้งสมาชิกทาง DM ว่า ticket ถูกปิดแล้ว
 * DM ไม่ได้ (ปิด DM/ออกจากเซิร์ฟ/บล็อกบอท) = ช่างมัน — เรื่องถูกปิดไปแล้ว ไม่มีอะไรต้องย้อน
 */
export async function notifyTicketClosed(
  client: Client,
  item: Pick<QueueRow, "subject_id" | "title">,
  guildName?: string,
): Promise<void> {
  if (!item.subject_id) return;
  try {
    const user = await client.users.fetch(item.subject_id);
    await user.send(
      `✅ ticket ของคุณเรื่อง **${item.title}**` +
        (guildName ? ` ในเซิร์ฟเวอร์ **${guildName}**` : "") +
        " ถูกผู้ดูแลปิดแล้ว\nถ้ายังมีเรื่องค้างใจ เปิด /ticket ใหม่ได้เลย",
    );
  } catch {
    // ส่งไม่ได้ก็ไม่ต้องทำอะไร
  }
}
