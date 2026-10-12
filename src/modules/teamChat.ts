import type { Client } from "discord.js";
import { guildOf, roleOf, type Role } from "../auth/access.js";
import { GENERAL, dmMembers, type TeamMessage } from "../store/teamChatStore.js";

/**
 * ส่วนของแชททีมที่ต้องคุยกับ Discord: รายชื่อทีม (คนที่มียศ admin/mod) และ DM แจ้งคนที่ถูกแท็ก
 */

export interface StaffPerson {
  id: string;
  /** ชื่อที่โชว์ในเซิร์ฟ (ชื่อเล่น) — แท็กด้วยชื่อนี้ */
  name: string;
  username: string;
  role: Role;
}

/** ทุกคนที่เข้า dashboard ได้ตอนนี้ (มียศ admin/mod) — admin ขึ้นก่อน แล้วเรียงตามชื่อ */
export async function listStaff(client?: Client): Promise<StaffPerson[]> {
  const guild = client ? guildOf(client) : null;
  if (!guild) return [];
  // cache อาจมีแค่คนที่เพิ่งเคลื่อนไหว — ดึงครบครั้งหนึ่ง พลาดก็ใช้ที่มี
  await guild.members.fetch().catch(() => null);
  return [...guild.members.cache.values()]
    .filter((m) => !m.user.bot)
    .map((m) => ({ id: m.id, name: m.displayName, username: m.user.username, role: roleOf(m) }))
    .filter((p): p is StaffPerson => p.role !== null)
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));
}

function roomLabel(room: string, recipientId: string): string {
  if (room === GENERAL) return "ห้องรวม";
  return dmMembers(room)?.includes(recipientId) ? "คุยส่วนตัว" : "แชททีม";
}

/**
 * DM คนที่ถูกแท็กผ่านบอท — ส่งไม่ได้ (ปิด DM) ก็ข้ามไป บนเว็บยังขึ้นจุดแจ้งเตือนอยู่ดี
 * คืนรายชื่อ id ที่ DM ถึง
 */
export async function notifyMentions(
  client: Client | undefined,
  msg: TeamMessage,
  /** แท็กด้วย @all — ข้อความ DM บอกว่าแท็กทุกคน */
  all = false,
): Promise<string[]> {
  if (!client) return [];
  const base = process.env.DASHBOARD_URL?.trim().replace(/\/+$/, "");
  const excerpt = msg.body.length > 300 ? `${msg.body.slice(0, 300)}…` : msg.body;
  const quoted = excerpt ? excerpt.split("\n").map((l) => `> ${l}`).join("\n") : "> (ไฟล์แนบ)";
  const sent: string[] = [];
  for (const id of msg.mentions) {
    try {
      const user = await client.users.fetch(id);
      // โดนแจ้งเพราะมีคนตอบกลับข้อความของเรา (ไม่ได้ @ ในข้อความ) — บอกให้ตรง
      const action = all ? "แท็กทุกคน" : msg.replyTo?.authorId === id ? "ตอบกลับข้อความของคุณ" : "แท็กคุณ";
      await user.send(
        `💬 **${msg.authorName}** ${action}ในแชททีม (${roomLabel(msg.room, id)})\n${quoted}` +
          (base ? `\n${base}/team` : ""),
      );
      sent.push(id);
    } catch {
      /* ปิด DM / ไม่พบผู้ใช้ — ไม่เป็นไร */
    }
  }
  return sent;
}
