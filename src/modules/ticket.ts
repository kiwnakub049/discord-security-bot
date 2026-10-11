import type { Client, GuildMember, Message, User } from "discord.js";
import { config } from "../config.js";
import { enqueue, openItemFor, type QueueRow } from "../store/queueStore.js";
import { addMessage } from "../store/ticketStore.js";

/**
 * Ticket ตำรวจ → แอดมิน — ตำรวจเปิดเรื่องผ่าน /ticket แล้วไปรอในคิวบน dashboard
 *
 * คุยโต้ตอบกันผ่าน DM ของบอท: แอดมินพิมพ์ตอบบนเว็บ → บอท DM ต่อให้ตำรวจ
 * ตำรวจตอบใน DM → บันทึกเข้าบทสนทนาของเรื่องนั้น (ค้างได้คนละเรื่องเดียว เลยรู้แน่ว่าเป็นของเรื่องไหน)
 * โมดูลนี้ไม่รู้จักหน้าเว็บ: แค่ส่งเรื่องเข้าคิว เก็บข้อความ และส่ง DM
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
  authorName: string = userId,
): { id: number; created: boolean } {
  const existing = openItemFor(TICKET_CATEGORY, userId);
  const id = enqueue({ category: TICKET_CATEGORY, subjectId: userId, title: topic, detail });
  const created = id !== existing?.id;
  // รายละเอียดตอนเปิด = ข้อความแรกของบทสนทนา หน้าเว็บจะได้อ่านต่อเนื่องเป็นแชทเดียว
  if (created) {
    addMessage({ queueId: id, authorKind: "police", authorId: userId, authorName, body: detail });
  }
  return { id, created };
}

/**
 * เปิด ticket ได้ไหม — "no-role" = ยังไม่ได้ตั้งยศตำรวจในหน้าตั้งค่า, "not-police" = ไม่มียศนี้
 */
export function canOpenTicket(
  member: Pick<GuildMember, "roles"> | null,
): "ok" | "no-role" | "not-police" {
  const roleId = config.ticket.policeRoleId;
  if (!roleId) return "no-role";
  return member?.roles.cache.has(roleId) ? "ok" : "not-police";
}

/**
 * DM ยืนยันการเปิดเรื่อง — คืน false ถ้า DM ไม่ได้
 *
 * ส่งตั้งแต่ตอนเปิด เพราะช่องคุยทั้งหมดคือ DM ถ้าส่งไม่ได้ตอนนี้ แอดมินก็ตอบกลับไม่ได้เหมือนกัน
 * คำสั่งจะได้บอกตำรวจให้เปิด DM ตั้งแต่แรก ไม่ใช่มารู้ตอนรอคำตอบที่ไม่มีวันมาถึง
 */
export async function confirmTicketOpened(user: Pick<User, "send">, topic: string): Promise<boolean> {
  try {
    await user.send(
      `📨 เปิด ticket เรื่อง **${topic}** แล้ว\n` +
        "แอดมินตอบเมื่อไหร่จะส่งมาในแชทนี้ — มีอะไรเพิ่มเติมพิมพ์ตอบในแชทนี้ได้เลย ข้อความจะส่งถึงแอดมิน",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * DM ที่ส่งมาหาบอท → ถ้าคนนี้มี ticket ค้าง ให้เก็บเข้าบทสนทนาของเรื่องนั้น
 * คืน false = ไม่ใช่เรื่อง ticket (ให้ messageCreate ส่งต่อไป dmRelay ตามเดิม)
 */
export async function handleTicketDm(message: Message): Promise<boolean> {
  if (message.author.bot) return false;
  const item = openItemFor(TICKET_CATEGORY, message.author.id);
  if (!item) return false;

  // DM ที่ยังไม่อยู่ใน cache มาแบบ partial — ดึงเต็มก่อน (ต้องเปิด Partials.Message)
  let msg = message;
  if (msg.partial) {
    try {
      msg = await msg.fetch();
    } catch {
      return false;
    }
  }
  const attachments = [...msg.attachments.values()].map((a) => a.url);
  const body = msg.content?.trim() || (attachments.length ? "(ส่งไฟล์แนบ)" : "(ไม่มีข้อความ)");
  addMessage({
    queueId: item.id,
    authorKind: "police",
    authorId: msg.author.id,
    authorName: msg.author.tag,
    body,
    attachments,
  });
  // ✅ ใต้ข้อความ = ส่งถึงแอดมินแล้ว — ไม่ตอบเป็นข้อความ จะได้ไม่รกแชท
  await msg.react("✅").catch(() => {});
  return true;
}

/**
 * แอดมินตอบ ticket → DM ต่อให้ตำรวจ แล้วเก็บข้อความไว้ (DM ไม่ได้ก็ยังเก็บ หน้าเว็บจะขึ้นเตือน)
 */
export async function replyToTicket(
  client: Client,
  item: Pick<QueueRow, "id" | "subject_id" | "title">,
  adminName: string,
  body: string,
): Promise<{ delivered: boolean }> {
  let delivered = false;
  if (item.subject_id) {
    try {
      const user = await client.users.fetch(item.subject_id);
      const quoted = body.split("\n").map((l) => `> ${l}`).join("\n");
      await user.send(
        `💬 แอดมิน **${adminName}** ตอบ ticket เรื่อง **${item.title}**\n${quoted}\n\n` +
          "ตอบกลับในแชทนี้ได้เลย",
      );
      delivered = true;
    } catch {
      // ตำรวจปิด DM/ออกจากเซิร์ฟ/บล็อกบอท — เก็บไว้เหมือนเดิม แต่บอกหน้าเว็บว่าส่งไม่ถึง
    }
  }
  addMessage({
    queueId: item.id,
    authorKind: "admin",
    authorId: adminName,
    authorName: adminName,
    body,
    delivered,
  });
  return { delivered };
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
        " ถูกผู้ดูแลปิดแล้ว\nข้อความที่พิมพ์ในแชทนี้หลังจากนี้จะไม่ถึงแอดมิน — มีเรื่องใหม่เปิด /ticket ได้เลย",
    );
  } catch {
    // ส่งไม่ได้ก็ไม่ต้องทำอะไร
  }
}
