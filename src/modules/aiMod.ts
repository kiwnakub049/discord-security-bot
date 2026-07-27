import { type Message } from "discord.js";
import { config } from "../config.js";
import { logEvent } from "../utils/logger.js";
import { isExempt } from "../utils/exempt.js";
import { warnMember } from "./warnAction.js";

/**
 * AI mod: ส่งข้อความให้ toxic classifier ภาษาไทย (toxic-serve / pi_serve.py
 * บนเครื่องเดียวกัน) ช่วยตัดสิน — จับ "เจตนาโจมตีคน" ที่ regex/bannedWords จับไม่ได้
 *
 * โซนที่ service คืนมา (threshold อยู่ใน model_card.json ฝั่งโน้น):
 *   "ignore" -> ไม่ทำอะไร
 *   "review" -> log ขึ้น dashboard ให้ mod ตัดสิน (ไม่แตะข้อความ)
 *   "auto"   -> ลบข้อความ + warnMember (เข้าระบบเตือน/escalation ปกติ)
 *
 * หลักการสำคัญ:
 *   - fail-open: service ล่ม/ช้า = ปล่อยข้อความผ่าน บอทต้องไม่ตายตามโมเดล
 *   - ส่งทีละข้อความเสมอ — dynamic int8 ทำให้คะแนนเปลี่ยนตามเพื่อนร่วม batch
 */

type Zone = "ignore" | "review" | "auto";
type ClassifyResult = { score: number; zone: Zone; label: string };

// กัน log สแปมตอน service ล่ม — เตือนซ้ำอย่างเร็วสุดทุก 5 นาที
const SERVICE_ERROR_COOLDOWN_MS = 5 * 60 * 1000;
let lastServiceErrorAt = 0;

async function classify(text: string): Promise<ClassifyResult | null> {
  const res = await fetch(config.aiMod.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: [text] }),
    signal: AbortSignal.timeout(config.aiMod.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { results?: ClassifyResult[] };
  return data.results?.[0] ?? null;
}

function excerpt(text: string, max = 180): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

/**
 * คืน true ถ้าจัดการ (ลบ/ลงโทษ) ข้อความนี้แล้ว
 * โซน review คืน false — ข้อความยังอยู่ ให้ flow ปกติ (XP ฯลฯ) เดินต่อ
 */
export async function handleAiMod(message: Message): Promise<boolean> {
  if (!config.aiMod.enabled) return false;
  if (!message.guild || !message.member) return false;
  if (isExempt(message.member)) return false;
  if (message.content.trim().length < config.aiMod.minLength) return false;

  let result: ClassifyResult | null;
  try {
    result = await classify(message.content);
  } catch (err) {
    const now = Date.now();
    if (now - lastServiceErrorAt > SERVICE_ERROR_COOLDOWN_MS) {
      lastServiceErrorAt = now;
      await logEvent(
        message.client, "warn", "system", "system_ai",
        "เรียก AI classifier ไม่ได้ — ปล่อยข้อความผ่านชั่วคราว",
        [
          { name: "URL", value: config.aiMod.url },
          { name: "สาเหตุ", value: String(err).slice(0, 120) },
        ],
      );
    }
    return false;
  }
  if (!result) return false;

  if (result.zone === "auto") {
    try {
      if (config.aiMod.deleteOnAuto && message.deletable) {
        await message.delete();
      }
      const bot = message.client.user;
      const { count, actionMsg } = await warnMember(
        message.member,
        bot?.id ?? "0",
        bot?.tag ?? "AI Mod",
        `AI ตรวจพบข้อความ toxic (คะแนน ${result.score.toFixed(2)})`,
      );
      await logEvent(
        message.client, "alert", "security", "security_ai",
        "AI ตรวจพบข้อความ toxic — จัดการอัตโนมัติ",
        [
          { name: "User", value: `${message.author.tag} (${message.author.id})` },
          { name: "ห้อง", value: `<#${message.channelId}>` },
          { name: "คะแนน", value: result.score.toFixed(4) },
          { name: "ข้อความ", value: excerpt(message.content) },
          { name: "เตือนสะสม", value: `${count} ครั้ง ${actionMsg}`.trim() },
        ],
      );
    } catch (err) {
      console.error("ai-mod auto action ไม่สำเร็จ:", err);
    }
    return true;
  }

  if (result.zone === "review") {
    // ไม่แตะข้อความ — ขึ้น dashboard ให้ mod ตัดสิน
    // (ผลตัดสินของ mod ในโซนนี้ = label ฟรีสำหรับเทรนโมเดลรอบหน้า)
    await logEvent(
      message.client, "warn", "security", "security_ai",
      "AI สงสัยว่าเป็นข้อความ toxic — รอ mod ตรวจ",
      [
        { name: "User", value: `${message.author.tag} (${message.author.id})` },
        { name: "ห้อง", value: `<#${message.channelId}>` },
        { name: "คะแนน", value: result.score.toFixed(4) },
        { name: "ข้อความ", value: excerpt(message.content) },
      ],
    );
  }

  return false;
}
