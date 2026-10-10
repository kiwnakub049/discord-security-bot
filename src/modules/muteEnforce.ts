import type { Client, Guild, GuildMember, VoiceState } from "discord.js";
import { logEvent } from "../utils/logger.js";
import {
  clearMutePunishment,
  getActiveMute,
  listActiveMutes,
  listExpiredMutes,
} from "./mutePunishmentStore.js";

/**
 * บังคับโทษ "ไมค์แดง" (server mute) จากระบบเตือน
 *
 * ทำไมต้องมี: Discord server mute ปลดได้โดยใครก็ตามที่มีสิทธิ์ Mute Members และ
 * ไม่มีตัวจับเวลาในตัว โมดูลนี้เลยดูแล 3 อย่าง:
 *   1. enforceMute  — มีคนไปปลด/คนโดนโทษเพิ่งเข้าห้องแล้วไม่ได้ถูก mute → ปิดกลับทันที
 *   2. loop ครบกำหนด — ครบเวลาแล้วปลดให้เอง (Discord ไม่ปลดให้)
 *   3. seed ตอนบูต  — กลับมาบังคับต่อหลังบอท restart
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
  setInterval(() => {
    for (const p of listExpiredMutes()) {
      void releaseExpired(client, p.guildId, p.userId, p.reason);
    }
  }, 30_000).unref();
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
  // ปลดจริงเฉพาะตอนยังอยู่ในห้องและยังแดงอยู่ — ถ้าออกห้องไปแล้วก็แค่ล้างทะเบียน
  if (member?.voice.channel && member.voice.serverMute) {
    await setServerMute(member, false, "ครบกำหนดลงโทษไมค์แดง");
    await logEvent(client, "info", "security", "security_mute_end", "ครบกำหนดไมค์แดง — ปลดให้แล้ว", [
      { name: "User", value: `${member.user.tag} (${member.id})` },
      { name: "จากโทษ", value: reason },
    ]);
  }
  clearMutePunishment(userId);
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
}
