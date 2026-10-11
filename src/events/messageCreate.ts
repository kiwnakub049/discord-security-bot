import { Events, type Message } from "discord.js";
import { config } from "../config.js";
import { handleAiMod } from "../modules/aiMod.js";
import { handleSpamCheck } from "../modules/antiSpam.js";
import { handleAutoMod } from "../modules/autoMod.js";
import { recordMessage } from "../store/activityStore.js";
import { handleDmReply } from "../modules/dmRelay.js";
import { handleTicketDm } from "../modules/ticket.js";
import { logEvent } from "../utils/logger.js";

export const name = Events.MessageCreate;

export async function execute(message: Message): Promise<void> {
  if (message.author.bot) return; // ข้ามข้อความจากบอท (รวม DM ที่บอทส่งเอง)

  // DM จากคน (ไม่มี guild): ticket ที่ค้างอยู่มาก่อน (ตำรวจคุยกับแอดมิน)
  // ไม่ใช่เรื่อง ticket = คำตอบกลับหลังถูกเตือน → relay ให้ mod เห็น แล้วจบ
  if (!message.guild) {
    if (await handleTicketDm(message)) return;
    await handleDmReply(message);
    return;
  }

  // auto-mod ก่อน (ลบลิงก์อันตรายให้ไวที่สุด) แล้วค่อย anti-spam
  const handled = await handleAutoMod(message);
  if (handled) return;

  const spam = await handleSpamCheck(message);
  if (spam) return;

  // ด่านสุดท้าย: AI classifier — แพงสุด (~20ms + เรียก HTTP) เลยไว้หลัง regex/spam
  const toxic = await handleAiMod(message);
  if (toxic) return;

  // ข้อความที่ผ่านด่านแล้ว = activity จริง → สะสม XP (มี cooldown กัน farm)
  if (config.activity.enabled) {
    const r = recordMessage(message.author.id);
    if (r.leveledUp) {
      await logEvent(message.client, "info", "member", "member_levelup", "เลื่อนเลเวล!", [
        { name: "User", value: `${message.author.tag} (${message.author.id})` },
        { name: "เลเวล", value: `${r.oldLevel} → ${r.newLevel}` },
        { name: "จาก", value: "ข้อความ" },
      ]);
    }
  }
}
