import type { Guild, VoiceState } from "discord.js";

/**
 * ติดตาม "สถานะเสียงปัจจุบัน" ของแต่ละคน (in-memory)
 * ใช้โชว์บน dashboard ว่าตอนนี้ใครอยู่ห้องไหน ปิดไมค์/ปิดหูฟังอยู่ไหม
 */

export interface VoiceInfo {
  channelId: string;
  channelName: string;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  streaming: boolean;
  selfVideo: boolean;
  since: number; // เข้าห้องตั้งแต่เมื่อไหร่ (epoch ms)
}

const states = new Map<string, VoiceInfo>();

function applyState(s: VoiceState): void {
  if (!s.channelId) return;
  const prev = states.get(s.id);
  states.set(s.id, {
    channelId: s.channelId,
    channelName: s.channel?.name ?? s.channelId,
    selfMute: Boolean(s.selfMute),
    selfDeaf: Boolean(s.selfDeaf),
    serverMute: Boolean(s.serverMute),
    serverDeaf: Boolean(s.serverDeaf),
    streaming: Boolean(s.streaming),
    selfVideo: Boolean(s.selfVideo),
    since: prev?.since ?? Date.now(),
  });
}

/** เรียกจาก voiceStateUpdate — อัปเดต/ลบสถานะ */
export function updateVoiceState(
  _oldState: VoiceState,
  newState: VoiceState,
): void {
  if (!newState.channelId) {
    states.delete(newState.id); // ออกจากห้องเสียงแล้ว
    return;
  }
  applyState(newState);
}

/** เติมสถานะจาก cache ตอนบอทเพิ่งออนไลน์ (คนที่อยู่ในห้องอยู่แล้ว) */
export function seedVoiceStates(guild: Guild): void {
  for (const vs of guild.voiceStates.cache.values()) {
    if (vs.channelId) applyState(vs);
  }
}

export function getVoiceState(userId: string): VoiceInfo | null {
  return states.get(userId) ?? null;
}

/** คนที่อยู่ในห้องเสียงตอนนี้ทั้งหมด (สำหรับหน้าภาพรวม) */
export function getVoiceStates(): (VoiceInfo & { userId: string })[] {
  return [...states.entries()].map(([userId, v]) => ({ userId, ...v }));
}
