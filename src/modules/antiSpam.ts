import { type Message } from "discord.js";
import { config } from "../config.js";
import { logEvent } from "../utils/logger.js";
import { isExempt } from "../utils/exempt.js";
import { dmAction } from "./dmNotice.js";

interface UserRecord {
  timestamps: number[]; // เวลาส่งข้อความล่าสุด
  lastContents: string[]; // เนื้อหาข้อความล่าสุด (ไว้เช็คซ้ำ)
}

// key = `${guildId}:${userId}`
const records = new Map<string, UserRecord>();

// เคลียร์ record ของคนที่ไม่ได้พิมพ์มานาน ทุก 10 นาที กัน memory โต
setInterval(
  () => {
    const now = Date.now();
    for (const [key, rec] of records) {
      if (!rec.timestamps.some((t) => now - t < config.antiSpam.windowMs)) {
        records.delete(key);
      }
    }
  },
  10 * 60 * 1000,
).unref();

/**
 * คืน true ถ้าจัดการ (ลงโทษ) ข้อความนี้แล้ว — ผู้เรียกจะได้ไม่ต้องตรวจต่อ
 */
export async function handleSpamCheck(message: Message): Promise<boolean> {
  if (!config.antiSpam.enabled) return false;
  if (!message.guild || !message.member) return false;
  if (isExempt(message.member)) return false;

  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;
  const rec = records.get(key) ?? { timestamps: [], lastContents: [] };

  // --- เช็ค mention spam (เช็คก่อน เพราะรุนแรง) ---
  const mentionCount =
    message.mentions.users.size + message.mentions.roles.size;
  if (mentionCount > config.antiSpam.maxMentions) {
    await punish(message, `mention เยอะเกินไป (${mentionCount})`);
    return true;
  }

  // --- เช็คความถี่ ---
  rec.timestamps = rec.timestamps.filter(
    (t) => now - t < config.antiSpam.windowMs,
  );
  rec.timestamps.push(now);

  // --- เช็คข้อความซ้ำ ---
  const content = message.content.trim().toLowerCase();
  if (content.length > 0) {
    rec.lastContents.push(content);
    if (rec.lastContents.length > config.antiSpam.maxDuplicates + 1) {
      rec.lastContents.shift();
    }
  }
  records.set(key, rec);

  const duplicateCount = rec.lastContents.filter((c) => c === content).length;

  if (rec.timestamps.length > config.antiSpam.maxMessages) {
    await punish(message, `ส่งข้อความถี่เกินไป (${rec.timestamps.length} ข้อความ)`);
    records.delete(key); // reset หลังลงโทษ
    return true;
  }

  if (content.length > 0 && duplicateCount > config.antiSpam.maxDuplicates) {
    await punish(message, `ส่งข้อความซ้ำ ๆ (${duplicateCount} ครั้ง)`);
    records.delete(key);
    return true;
  }

  return false;
}

async function punish(message: Message, reason: string): Promise<void> {
  const member = message.member;
  if (!member) return;

  try {
    // ลบข้อความล่าสุด
    if (message.deletable) await message.delete();

    // timeout (mute ชั่วคราว) ถ้าบอทมีสิทธิ์ + DM แจ้งผู้ใช้
    if (member.moderatable) {
      await dmAction(member, "spam", reason, config.antiSpam.timeoutMs);
      await member.timeout(config.antiSpam.timeoutMs, `Anti-spam: ${reason}`);
    }

    await logEvent(message.client, "warn", "security", "security_spam", "Anti-spam ลงโทษผู้ใช้", [
      { name: "User", value: `${member.user.tag} (${member.id})` },
      { name: "เหตุผล", value: reason },
      { name: "Timeout", value: `${config.antiSpam.timeoutMs / 1000}s` },
    ]);
  } catch (err) {
    console.error("ลงโทษ spam ไม่สำเร็จ:", err);
  }
}
