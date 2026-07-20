import { Events, type Message } from "discord.js";
import { handleSpamCheck } from "../modules/antiSpam.js";
import { handleAutoMod } from "../modules/autoMod.js";

export const name = Events.MessageCreate;

export async function execute(message: Message): Promise<void> {
  // ข้ามข้อความจากบอทและ DM
  if (message.author.bot || !message.guild) return;

  // auto-mod ก่อน (ลบลิงก์อันตรายให้ไวที่สุด) แล้วค่อย anti-spam
  const handled = await handleAutoMod(message);
  if (handled) return;

  await handleSpamCheck(message);
}
