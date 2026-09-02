import { GatewayIntentBits } from "discord.js";

/**
 * ตัดสินว่าจะขอ privileged intent จาก Discord หรือไม่
 *
 * ── ทำไมต้องมีสวิตช์นี้ ──
 * ตั้งแต่ 10 มิ.ย. 2026 Discord เปลี่ยนเกณฑ์: แอปที่ "คนเห็นได้" รวมกันเกิน 10,000 คน
 * ต้องยื่นขออนุมัติก่อนถึงจะเปิด privileged intent ได้ เซิร์ฟเวอร์นี้มีสมาชิก 45,000+
 * จึงเกินเกณฑ์ และสวิตช์ในหน้า Developer Portal ถูกล็อกไว้จนกว่าจะได้รับอนุมัติ
 *
 * ผลคือบอทล็อกอินไม่ผ่านเลย ("Used disallowed intents") — ไม่ใช่แค่ฟีเจอร์บางตัวหาย
 * แต่ต่อ Discord ไม่ติดทั้งตัว ระหว่างรออนุมัติจึงต้องมีทางให้รันแบบไม่ขอ intent พวกนั้น
 * เพื่อให้ส่วนที่ยังทำได้ (log ห้องเสียง / audit / dashboard) ไม่ดับตามไปด้วย
 *
 * ตั้ง DISCORD_NO_PRIVILEGED=1 ใน .env เพื่อเปิดโหมดนี้
 */

/** privileged — ต้องได้รับอนุมัติจาก Discord ก่อนถึงใช้ได้ */
const PRIVILEGED = [
  GatewayIntentBits.GuildMembers, // anti-raid + log เข้า-ออกเซิร์ฟเวอร์
  GatewayIntentBits.MessageContent, // anti-spam (ข้อความซ้ำ) / auto-mod / AI จับ toxic
];

/** ไม่ privileged — เปิดได้เองเสมอ */
const BASE = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates, // log เข้า/ออก/ย้ายห้องเสียง ไมค์แดง หูแดง
  GatewayIntentBits.GuildModeration, // ban/unban + audit log (รวมของบอทพาร์ทเนอร์)
  GatewayIntentBits.DirectMessages, // รับ DM ที่คนตอบกลับบอท (relay หลังถูกเตือน) — ไม่ privileged
];

export const privilegedDisabled = process.env.DISCORD_NO_PRIVILEGED === "1";

export const intents = privilegedDisabled ? BASE : [...BASE, ...PRIVILEGED];

/** ฟีเจอร์ที่ใช้ไม่ได้ในโหมดนี้ — เอาไปขึ้นเตือนทั้งใน log และบน dashboard */
export const disabledFeatures: string[] = privilegedDisabled
  ? [
      "anti-raid (ตรวจคนเข้าเซิร์ฟเวอร์รัว ๆ)",
      "log เข้า-ออกเซิร์ฟเวอร์",
      "auto-mod (คำต้องห้าม / ลิงก์เชิญ)",
      "AI จับข้อความ toxic",
      "anti-spam เฉพาะการจับข้อความซ้ำ (การจับส่งรัวและ mention เยอะ ยังทำงาน)",
    ]
  : [];

/** ขึ้นเตือนตอนบูต — โหมดนี้ทำให้การป้องกันหายไปหลายชั้น ห้ามให้เงียบ */
export function warnIfDegraded(): void {
  if (!privilegedDisabled) return;
  console.warn(
    "\n⚠️  รันโหมดไม่ขอ privileged intent — การป้องกันต่อไปนี้ปิดอยู่:\n" +
      disabledFeatures.map((f) => `     • ${f}`).join("\n") +
      "\n   ที่ยังทำงาน: log ห้องเสียง, audit log (ban/role/ห้อง), dashboard, บัตรสมาชิก\n" +
      "   เอาออกได้เมื่อ Discord อนุมัติ privileged intent แล้ว — ลบ DISCORD_NO_PRIVILEGED ออกจาก .env\n",
  );
}
