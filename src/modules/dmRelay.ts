import { type Message } from "discord.js";
import { getWarnings } from "./warningStore.js";
import { logEvent } from "../utils/logger.js";

/**
 * ส่งต่อ (relay) ข้อความที่ผู้ใช้ตอบกลับบอทใน DM → เข้า log/dashboard ให้ mod เห็น
 *
 * ใช้เป็น "ช่องอุทธรณ์": หลังบอท DM แจ้งเตือน คนโดนเตือนมักพิมพ์ตอบกลับมา
 * (ขอโทษ/อธิบาย/โต้แย้ง) ข้อความพวกนี้เดิมหายไปเพราะไม่มีใครเห็น โมดูลนี้ดึงมาโชว์
 *
 * ขอบเขต/ความเป็นส่วนตัว: อ่านได้เฉพาะ DM ที่ส่งมาหา "ตัวบอทเอง" เท่านั้น
 * ไม่ใช่แชทส่วนตัวของใครกับใคร และ relay เฉพาะคนที่ "เพิ่งถูกเตือน" (มีเตือนในช่วง
 * RELAY_WINDOW) เพื่อไม่ให้กลายเป็นกล่องรับ DM มั่ว ๆ จากคนทั่วไป
 */

// รับ relay เฉพาะถ้าเตือนล่าสุดไม่เกินช่วงนี้ (พ้นไปแล้วถือว่าไม่เกี่ยวกับการเตือน)
const RELAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน

function excerpt(text: string, max = 1000): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

export async function handleDmReply(message: Message): Promise<void> {
  if (message.author.bot) return; // ข้าม DM ที่บอทส่งเอง

  // DM ที่ยังไม่อยู่ใน cache มาแบบ partial — ดึงเต็มก่อน (ต้องเปิด Partials.Message)
  let msg = message;
  if (msg.partial) {
    try {
      msg = await msg.fetch();
    } catch {
      return;
    }
  }

  const ws = getWarnings(msg.author.id);
  if (!ws.length) return; // ไม่เคยโดนเตือน — ไม่ใช่ช่องอุทธรณ์ ไม่ relay
  const last = Math.max(...ws.map((w) => w.timestamp));
  if (Date.now() - last > RELAY_WINDOW_MS) return; // เตือนนานเกินไปแล้ว

  const content = msg.content?.trim();
  const attachments = [...msg.attachments.values()].map((a) => a.url);
  // MessageContent ปิด (โหมด degraded) → content ว่าง แต่ยังรู้ว่ามีการตอบกลับ
  const shown =
    content || (attachments.length ? "(ส่งไฟล์แนบ)" : "(ไม่มีข้อความ)");

  await logEvent(
    msg.client,
    "info",
    "member",
    "member_dm_reply",
    "ผู้ใช้ตอบกลับบอทใน DM (หลังถูกเตือน)",
    [
      { name: "User", value: `${msg.author.tag} (${msg.author.id})` },
      { name: "เตือนสะสม", value: `${ws.length} ครั้ง` },
      { name: "ข้อความ", value: excerpt(shown) },
      ...(attachments.length
        ? [{ name: "ไฟล์แนบ", value: attachments.join("\n").slice(0, 1000) }]
        : []),
    ],
  );
}
