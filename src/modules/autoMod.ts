import { type Message } from "discord.js";
import { config } from "../config.js";
import { logEvent } from "../utils/logger.js";
import { isExempt } from "../utils/exempt.js";
import { notifySecurity } from "./securityAlerts.js";

// จับลิงก์ invite ของ Discord ทุกรูปแบบ
const INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;

/*
 * นามสกุลไฟล์แนบอันตราย — ช่องทางแพร่ RAT/stealer (เช่น XWorm) ใน Discord คือ
 * หลอกให้โหลด "เกม/โปรแกรมฟรี" ที่แท้จริงเป็น .exe/.scr/.lnk ฯลฯ
 * regex จับที่ "ท้ายชื่อไฟล์" เลยครอบ double extension (invoice.pdf.exe) โดยธรรมชาติ
 * ไฟล์บีบอัด (.zip/.rar) จงใจไม่บล็อก — ใช้แชร์ของปกติกันเยอะ จะ false positive ท่วม
 */
const DANGEROUS_EXT = /\.(exe|scr|bat|cmd|com|pif|lnk|iso|img|jar|jse?|vbs|vbe|wsf|ps1|msix?|hta|cpl|reg|apk)$/i;

/*
 * โดเมนย่อลิงก์/วางโค้ด — ตัวมันไม่ผิด แต่เป็นวิธีมาตรฐานในการซ่อนปลายทางอันตราย
 * นโยบาย: "เตือน mod" อย่างเดียว ไม่ลบ (ลิงก์ย่อถูกใช้งานปกติบ่อย ลบจะรำคาญ)
 */
const SHORTENER_DOMAINS = [
  "bit.ly/", "tinyurl.com/", "cutt.ly/", "is.gd/", "t.ly/", "rb.gy/",
  "rebrand.ly/", "shorturl.at/", "tiny.cc/",
  "pastebin.com/raw", "paste.ee/r/", "rentry.co/",
];

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

  // --- ไฟล์แนบอันตราย (ช่องแพร่ XWorm/RAT) — เช็คก่อนเพื่อน ร้ายแรงสุด ---
  if (config.autoMod.blockDangerousFiles) {
    const files = [...(message.attachments?.values() ?? [])];
    const bad = files.find((a) => DANGEROUS_EXT.test(a.name ?? ""));
    if (bad) {
      await act(message, `แนบไฟล์อันตราย (${bad.name})`, "alert");
      void notifySecurity(
        "ไฟล์แนบอันตรายใน Discord",
        `${message.author.tag} แนบ "${bad.name}" ในห้อง #${message.channelId} — ลบแล้ว`,
      );
      return true;
    }
  }

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

  // --- ลิงก์ย่อ/paste: ซ่อนปลายทางได้ — เตือน mod แต่ไม่ลบ (กัน false positive) ---
  if (config.autoMod.flagShorteners) {
    const short = SHORTENER_DOMAINS.find((d) => content.includes(d));
    if (short) {
      await logEvent(message.client, "warn", "security", "security_automod", "ลิงก์ย่อ/paste — มองไม่เห็นปลายทาง", [
        { name: "User", value: `${message.author.tag} (${message.author.id})` },
        { name: "ห้อง", value: `<#${message.channelId}>` },
        { name: "โดเมน", value: short },
      ]);
      // ไม่ return — ข้อความยังอยู่ ให้ตรวจข้ออื่นต่อ (เช่นคำต้องห้ามในข้อความเดียวกัน)
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
