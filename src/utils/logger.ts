import {
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type TextChannel,
} from "discord.js";
import { config } from "../config.js";
import { addLog, type LogCategory, type LogLevel } from "../store/logStore.js";

const COLORS: Record<LogLevel, ColorResolvable> = {
  info: 0x5865f2, // น้ำเงิน Discord
  warn: 0xfee75c, // เหลือง
  alert: 0xed4245, // แดง
};

const EMOJI: Record<LogLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  alert: "🚨",
};

/**
 * log เหตุการณ์:
 *  1. เก็บลง log store (เว็บ dashboard + ไฟล์ถาวร)
 *  2. print ลง console
 *  3. ส่ง embed ไปห้อง log ใน Discord ถ้าตั้งค่าไว้
 */
export async function logEvent(
  client: Client,
  level: LogLevel,
  category: LogCategory,
  event: string,
  title: string,
  fields: { name: string; value: string }[] = [],
  description?: string,
): Promise<void> {
  // 1) log store (สำหรับเว็บ + persist)
  await addLog(level, category, event, title, fields, description);

  // 2) console — มีประโยชน์ตอน dev
  const fieldStr = fields.map((f) => `${f.name}=${f.value}`).join(" ");
  console.log(`${EMOJI[level]} [${level.toUpperCase()}] ${title} ${fieldStr}`);

  // 3) Discord
  if (!config.logChannelId) return;
  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS[level])
      .setTitle(`${EMOJI[level]} ${title}`)
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields);

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    console.error("ส่ง log ไปห้อง log ไม่สำเร็จ:", err);
  }
}
