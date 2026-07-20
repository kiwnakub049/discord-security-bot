import type { Guild, VoiceState } from "discord.js";
import { config } from "../config.js";
import { addVoiceTime, type XpResult } from "../store/activityStore.js";

/**
 * สะสม "เวลาในห้องเสียง" เป็น XP แบบอิง transition:
 *  - ทุกครั้งที่สถานะเสียงเปลี่ยน (เข้า/ออก/ย้าย/ปิด-เปิดไมค์) → flush เวลาที่นับค้างไว้
 *  - ถ้าสถานะใหม่ยัง "เข้าเงื่อนไขนับ" → เริ่มจับเวลาใหม่
 *
 * ไม่นับ: ห้อง AFK, บอท, และ (ถ้า voiceCountWhileMuted=false) ตอนปิดไมค์/หูฟัง
 */

// userId -> เวลาที่เริ่มนับ (epoch ms) — มีค่าเฉพาะคนที่กำลังถูกนับอยู่
const activeSince = new Map<string, number>();

/** สถานะนี้ควรถูกนับเวลา/XP ไหม */
export function isCounting(state: VoiceState): boolean {
  if (!state.channelId) return false; // ไม่อยู่ห้องเสียง
  if (state.channelId === state.guild.afkChannelId) return false; // ห้อง AFK
  if (config.activity.voiceCountWhileMuted) return true;
  return !(state.selfMute || state.selfDeaf || state.serverMute || state.serverDeaf);
}

/**
 * เรียกจาก voiceStateUpdate — flush เวลาเก่า + เริ่มนับใหม่ถ้ายังเข้าเงื่อนไข
 * คืน XpResult ของช่วงที่ flush (null ถ้าไม่มีอะไรให้ flush) — ผู้เรียกเช็ค .leveledUp ได้
 */
export function trackVoiceActivity(
  _oldState: VoiceState,
  newState: VoiceState,
  now: number = Date.now(),
): XpResult | null {
  if (!config.activity.enabled) return null;
  if (newState.member?.user.bot) return null;

  const userId = newState.id;
  let result: XpResult | null = null;
  const since = activeSince.get(userId);
  if (since !== undefined) {
    result = addVoiceTime(userId, (now - since) / 1000);
    activeSince.delete(userId);
  }
  if (isCounting(newState)) activeSince.set(userId, now);
  return result;
}

/** เติมสถานะตอนบอทออนไลน์ — เริ่มนับคนที่อยู่ในห้องอยู่แล้ว (นับจากตอนนี้) */
export function seedVoiceActivity(guild: Guild, now: number = Date.now()): void {
  if (!config.activity.enabled) return;
  for (const vs of guild.voiceStates.cache.values()) {
    if (vs.member?.user.bot) continue;
    if (isCounting(vs)) activeSince.set(vs.id, now);
  }
}

/** สำหรับเทส: ล้าง state ภายใน */
export function _resetVoiceActivity(): void {
  activeSince.clear();
}
