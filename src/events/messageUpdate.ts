import { Events, type Message, type PartialMessage } from "discord.js";
import { handleAutoMod } from "../modules/autoMod.js";

/**
 * รัน auto-mod ตอนแก้ข้อความด้วย — กันช่องโหว่ "โพสต์ข้อความปกติ แล้วแก้เป็นลิงก์อันตราย"
 * (ตัว messageCreate จับเฉพาะตอนโพสต์ใหม่ ไม่ครอบคลุมการแก้ทีหลัง)
 */
export const name = Events.MessageUpdate;

export async function execute(
  _oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> {
  let msg = newMessage;
  if (msg.partial) {
    try {
      msg = await msg.fetch();
    } catch {
      return; // ดึงข้อความเต็มไม่ได้ (ถูกลบ?) — ข้าม
    }
  }
  if (msg.author?.bot || !msg.guild) return;
  await handleAutoMod(msg as Message);
}
