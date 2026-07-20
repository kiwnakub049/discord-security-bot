import { type Message } from "discord.js";
import { config } from "../config.js";
import { logEvent } from "../utils/logger.js";
import { isExempt } from "../utils/exempt.js";

// จับลิงก์ invite ของ Discord ทุกรูปแบบ
const INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;

// โดเมนหลอกลวงที่พบบ่อย (ตัวอย่าง — เพิ่มได้เรื่อย ๆ)
const PHISHING_DOMAINS = [
  "discordnitro.",
  "discord-nitro.",
  "discordgift.",
  "discord-gift.",
  "steamcommunity-",
  "discordapp.gift",
  "free-nitro",
  "dlscord.", // typosquatting ของ discord
  "steamcomunnity.",
];

/**
 * คืน true ถ้าจัดการ (ลบ/ลงโทษ) ข้อความนี้แล้ว
 */
export async function handleAutoMod(message: Message): Promise<boolean> {
  if (!config.autoMod.enabled) return false;
  if (!message.guild || !message.member) return false;
  if (isExempt(message.member)) return false;

  const content = message.content.toLowerCase();

  // --- invite ของเซิร์ฟเวอร์อื่น ---
  if (config.autoMod.blockInvites && INVITE_REGEX.test(message.content)) {
    await act(message, "โพสต์ลิงก์เชิญ (invite) เซิร์ฟเวอร์อื่น");
    return true;
  }

  // --- โดเมน phishing ---
  if (config.autoMod.blockPhishing) {
    const hit = PHISHING_DOMAINS.find((d) => content.includes(d));
    if (hit) {
      await act(message, `ลิงก์น่าสงสัย/หลอกลวง (${hit})`, "alert");
      return true;
    }
  }

  // --- คำต้องห้าม ---
  if (config.autoMod.bannedWords.length > 0) {
    const word = config.autoMod.bannedWords.find((w) =>
      content.includes(w.toLowerCase()),
    );
    if (word) {
      await act(message, "ใช้คำต้องห้าม");
      return true;
    }
  }

  return false;
}

async function act(
  message: Message,
  reason: string,
  level: "warn" | "alert" = "warn",
): Promise<void> {
  try {
    if (config.autoMod.deleteOnViolation && message.deletable) {
      await message.delete();
    }
    await logEvent(message.client, level, "security", "security_automod", "Auto-mod ตรวจพบการละเมิด", [
      { name: "User", value: `${message.author.tag} (${message.author.id})` },
      { name: "ห้อง", value: `<#${message.channelId}>` },
      { name: "เหตุผล", value: reason },
    ]);
  } catch (err) {
    console.error("auto-mod action ไม่สำเร็จ:", err);
  }
}
