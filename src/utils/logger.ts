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

/** ช่องที่ค่าข้างในเป็นห้อง ไม่ใช่คน — ต้องตรงกับ CHANNEL_FIELDS ฝั่งหน้าเว็บ */
const CHANNEL_FIELDS = new Set(["ห้อง", "จาก", "ไป", "ห้องเสียง"]);

/**
 * เปลี่ยน id ในข้อความให้เป็น mention ของ Discord เพื่อให้กดได้ในห้อง log
 *
 * ทำเฉพาะตอนส่งเข้า Discord เท่านั้น — ใน DB กับหน้าเว็บยังเก็บข้อความปกติ
 * เพราะ "<#123>" ที่ไหนก็ตามที่ไม่ใช่ Discord จะกลายเป็นขยะที่อ่านไม่ออก
 *
 * ห้อง: เก็บชื่อที่บันทึกไว้ตอนนั้นแล้วต่อ mention ข้างหลัง — ถ้าห้องถูกเปลี่ยนชื่อ
 * ทีหลัง จะยังเห็นทั้งชื่อเดิม ณ วันเกิดเหตุ และชื่อปัจจุบันที่ Discord วาดให้
 *
 * คน: แทนตัวเลข id ด้วย mention — username ที่บันทึกไว้ยังอยู่ในวงเล็บข้างหน้า
 * เลยไม่เสียข้อมูลถ้าคนนั้นเปลี่ยนชื่อหรือออกจากเซิร์ฟเวอร์ไปแล้ว
 *
 * mention ใน embed ไม่ ping ใครอยู่แล้ว (Discord ไม่ส่งแจ้งเตือนจาก embed)
 */
export function mentionize(fieldName: string, value: string): string {
  if (CHANNEL_FIELDS.has(fieldName)) {
    return value.replace(/\((\d{17,20})\)\s*$/, "(<#$1>)");
  }
  return value.replace(/\b(\d{17,20})\b/g, "<@$1>");
}

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

    if (description) embed.setDescription(description.slice(0, 4096));
    /*
     * ตัดให้พอดีขีดจำกัดของ Discord ก่อนส่ง — ชื่อ 256, ค่า 1024, ไม่เกิน 25 ช่อง
     * ถ้าเกิน Discord ปฏิเสธทั้ง embed แปลว่า log หายไปทั้งอันจากห้อง log
     * โดยที่ฝั่ง DB เก็บครบ ทำให้ "ในเว็บมี แต่ในดิสคอร์ดไม่มี" ซึ่งหาสาเหตุยากมาก
     *
     * ตัดเฉพาะขาที่ส่งเข้า Discord เท่านั้น — addLog() ด้านบนเก็บของเต็มไปแล้ว
     */
    if (fields.length) {
      embed.addFields(
        fields.slice(0, 25).map((f) => {
          // ทำ mention ก่อนตัด เพราะ mention ยาวกว่าข้อความเดิม
          const value = mentionize(f.name, f.value);
          return {
            name: f.name.slice(0, 256),
            value:
              value.length > 1024 ? `${value.slice(0, 1000)}\n… (ดูเต็มในเว็บ)` : value,
          };
        }),
      );
    }

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    console.error("ส่ง log ไปห้อง log ไม่สำเร็จ:", err);
  }
}
