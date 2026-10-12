import type { Client, Guild, GuildMember, VoiceState } from "discord.js";
import { logEvent } from "../utils/logger.js";
import {
  clearMutePunishment,
  clearReleasePending,
  getActiveMute,
  getReleasePending,
  listActiveMutes,
  listExpiredMutes,
  listReleasePending,
  markReleasePending,
} from "./mutePunishmentStore.js";

/**
 * บังคับโทษ "ไมค์แดง" (server mute) จากระบบเตือน
 *
 * ทำไมต้องมี: Discord server mute ปลดได้โดยใครก็ตามที่มีสิทธิ์ Mute Members และ
 * ไม่มีตัวจับเวลาในตัว โมดูลนี้เลยดูแล 3 อย่าง:
 *   1. enforceMute  — มีคนไปปลด/คนโดนโทษเพิ่งเข้าห้องแล้วไม่ได้ถูก mute → ปิดกลับทันที
 *   2. loop ครบกำหนด — ครบเวลาแล้วปลดให้เอง (Discord ไม่ปลดให้)
 *   3. seed ตอนบูต  — กลับมาบังคับต่อหลังบอท restart
 *   4. ค้างปลด      — ครบเวลา/สั่งปลดตอนคนนั้นอยู่นอกห้อง Discord ปลดให้ไม่ได้
 *                     แต่ mute ติดตัวไปห้องถัดไป → จดไว้ แล้วปลดทันทีที่กลับเข้าห้อง
 */

/** ปิด/เปิดไมค์ (server mute) ของสมาชิก — คืน false ถ้าทำไม่ได้ (สิทธิ์?) */
async function setServerMute(
  member: GuildMember,
  mute: boolean,
  reason: string,
): Promise<boolean> {
  try {
    await member.voice.setMute(mute, reason);
    return true;
  } catch (err) {
    console.error(`ตั้ง server mute (${mute}) ไม่สำเร็จ:`, err);
    return false;
  }
}

/**
 * เรียกจาก voiceStateUpdate — ถ้าคนที่ยังอยู่ในช่วงโทษไมค์แดงถูกปลด (หรือเพิ่งเข้าห้อง
 * โดยไม่ได้ถูก mute) ให้ปิดกลับทันที
 *
 * กันลูป: ตอนเราสั่ง mute เอง จะเกิด voiceStateUpdate ที่ serverMute = true ซึ่ง
 * เงื่อนไข `newState.serverMute` ด้านล่างตัดจบ ไม่วนซ้ำ
 */
export async function enforceMute(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const member = newState.member;
  if (!member || !newState.channel) return; // ไม่ได้อยู่ในห้องเสียง

  // ไมค์แดงที่ค้างปลดจากรอบก่อน (ครบเวลาตอนอยู่นอกห้อง) — กลับเข้ามาแล้ว ปลดให้เลย
  // เช็ค getActiveMute ด้วย: ถ้าโดนโทษรอบใหม่ไปแล้ว ต้องแดงต่อ ไม่ใช่ปลดตามรายการเก่า
  if (newState.serverMute && !getActiveMute(member.id)) {
    const pending = getReleasePending(member.id);
    if (pending) {
      await releasePendingNow(member, pending.reason);
      return;
    }
  }

  if (newState.serverMute) return; // ถูกปิดไมค์อยู่แล้ว ไม่ต้องทำอะไร
  const p = getActiveMute(member.id);
  if (!p) return; // ไม่ได้อยู่ในช่วงโทษ

  const ok = await setServerMute(
    member,
    true,
    "ไมค์แดง: ยังอยู่ในช่วงลงโทษจากระบบเตือน",
  );
  if (!ok) return;

  // มีคนเพิ่งปลดให้ (แดง→ปกติ) vs เพิ่งเข้าห้อง — แยกข้อความให้อ่านออกว่าเกิดอะไร
  const wasUnmuted = oldState.serverMute && !newState.serverMute;
  // <t:วินาที:R> = Discord นับถอยหลังสดในช่อง log ให้ mod เห็นเวลาที่เหลือ
  const untilSec = Math.floor(p.until / 1000);
  await logEvent(
    member.client,
    "warn",
    "security",
    "security_mute_enforce",
    wasUnmuted ? "มีคนปลดไมค์แดงก่อนเวลา — ปิดกลับทันที" : "คนโดนโทษเข้าห้อง — ปิดไมค์แดงต่อ",
    [
      { name: "User", value: `${member.user.tag} (${member.id})` },
      { name: "ห้อง", value: `<#${newState.channel.id}>` },
      { name: "ปลดให้", value: `<t:${untilSec}:R>` },
    ],
  );
}

/**
 * ลูปตรวจโทษที่ครบกำหนด แล้วปลดไมค์ให้เอง — เรียกครั้งเดียวตอนบอทออนไลน์
 * granularity 30 วิ (โทษเป็นหลักชั่วโมง ช้าไปครึ่งนาทีไม่มีผล)
 */
export function startMuteExpiryLoop(client: Client): void {
  setInterval(() => void releaseExpiredMutes(client), 30_000).unref();
}

/** ปลดโทษที่ครบกำหนดทั้งหมด (หนึ่งรอบของลูป — แยกออกมาให้เทสเรียกตรงได้) */
export async function releaseExpiredMutes(client: Client): Promise<void> {
  for (const p of listExpiredMutes()) {
    await releaseExpired(client, p.guildId, p.userId, p.reason);
  }
}

async function releaseExpired(
  client: Client,
  guildId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  const member = guild
    ? await guild.members.fetch(userId).catch(() => null)
    : null;
  clearMutePunishment(userId);
  if (!member) return; // ออกจากเซิร์ฟไปแล้ว — กลับมาใหม่ mute ก็ไม่ติดมาด้วย

  if (member.voice.channel) {
    if (!member.voice.serverMute) return; // มีคนปลดไปแล้ว
    await setServerMute(member, false, "ครบกำหนดลงโทษไมค์แดง");
    await logEvent(client, "info", "security", "security_mute_end", "ครบกำหนดไมค์แดง — ปลดให้แล้ว", [
      { name: "User", value: `${member.user.tag} (${member.id})` },
      { name: "จากโทษ", value: reason },
    ]);
    return;
  }
  // อยู่นอกห้อง: Discord ปลดให้ไม่ได้ แต่ mute ยังติดตัว — เดิมตรงนี้แค่ล้างทะเบียน
  // แล้วคนนั้นกลับเข้าห้องมาก็แดงค้างถาวรไม่มีใครปลด จดไว้ให้ enforceMute ปลดตอนเข้าห้อง
  markReleasePending(userId, guildId, reason);
}

/**
 * ตอนบอทออนไลน์: กลับมาบังคับโทษที่ยังไม่หมดเวลาต่อ
 * (เผื่อมีคนถูกปลดตอนบอทดับ หรือเพิ่งเข้าห้องระหว่างบอทไม่อยู่)
 */
export async function seedMuteEnforcement(guild: Guild): Promise<void> {
  for (const p of listActiveMutes()) {
    if (p.guildId !== guild.id) continue;
    const member = await guild.members.fetch(p.userId).catch(() => null);
    if (member?.voice.channel && !member.voice.serverMute) {
      await setServerMute(member, true, "ไมค์แดง: บังคับต่อหลังบอทออนไลน์");
    }
  }
  // ค้างปลดที่คนนั้นกลับเข้าห้องมาระหว่างบอทดับ — ไม่มี voiceStateUpdate ให้จับแล้ว ปลดตอนนี้เลย
  for (const p of listReleasePending()) {
    if (p.guildId !== guild.id || getActiveMute(p.userId)) continue;
    const member = await guild.members.fetch(p.userId).catch(() => null);
    if (member?.voice.channel && member.voice.serverMute) {
      await releasePendingNow(member, p.reason);
    }
  }
}

/** ปลดไมค์ที่ค้างปลดไว้ (คนนั้นอยู่ในห้องแล้ว) — ปลดไม่สำเร็จ = เก็บรายการไว้ลองรอบหน้า */
async function releasePendingNow(member: GuildMember, reason: string): Promise<void> {
  if (!(await setServerMute(member, false, "ปลดไมค์แดงที่ค้าง (ครบเวลาตอนอยู่นอกห้อง)"))) return;
  clearReleasePending(member.id);
  await logEvent(member.client, "info", "security", "security_mute_end", "ปลดไมค์แดงที่ค้าง — ครบเวลาตอนอยู่นอกห้อง", [
    { name: "User", value: `${member.user.tag} (${member.id})` },
    { name: "จากโทษ", value: reason },
  ]);
}

export type ReleaseResult = "unmuted" | "pending" | "not-muted" | "not-found" | "failed";

/**
 * ปลดไมค์แดงทันที (ปุ่มปลดฉุกเฉินจาก dashboard) — ยกเลิกโทษที่เหลือด้วย
 * ไม่งั้นปลดแล้ว enforceMute จะเห็นว่ายังอยู่ในช่วงโทษแล้วปิดกลับทันที
 *
 *   unmuted   = อยู่ในห้อง ปลดแล้ว
 *   pending   = อยู่นอกห้อง (Discord ปลดตอนนี้ไม่ได้) → ปลดให้เองตอนกลับเข้าห้อง
 *   not-muted = ไม่ได้โดนโทษและไม่ได้แดงอยู่ ไม่มีอะไรให้ปลด
 */
export async function releaseMuteNow(guild: Guild, userId: string): Promise<ReleaseResult> {
  const punishment = getActiveMute(userId);
  clearMutePunishment(userId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return "not-found"; // ออกจากเซิร์ฟไปแล้ว — mute ไม่ติดตัวกลับมา

  if (member.voice.channel) {
    clearReleasePending(userId);
    if (!member.voice.serverMute) return punishment ? "unmuted" : "not-muted";
    return (await setServerMute(member, false, "ปลดไมค์แดงก่อนเวลา (dashboard)")) ? "unmuted" : "failed";
  }
  // นอกห้อง: ไม่รู้ได้ว่ายังแดงติดตัวอยู่ไหม (Discord บอกเฉพาะตอนอยู่ในห้อง)
  // จดไว้ทั้งที่มีโทษอยู่และที่ค้างปลดอยู่แล้ว — ตอนเข้าห้องจะปลดเฉพาะถ้ายังแดงจริง
  if (!punishment && !getReleasePending(userId)) return "not-muted";
  markReleasePending(userId, guild.id, punishment?.reason ?? "ปลดก่อนเวลา");
  return "pending";
}
