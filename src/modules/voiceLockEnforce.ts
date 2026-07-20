import type { VoiceState } from "discord.js";
import { voiceLockDB } from "./voiceLockStore.js";

/**
 * กัน Admin bypass ห้องที่ถูกล็อก
 *
 * ทำไม admin ยัง bypass ได้:
 *   การตั้ง `Connect: false` บน permission overwrite กันได้แค่ "คนทั่วไป"
 *   ผู้ที่มีสิทธิ์ **Administrator** จะข้าม (bypass) permission overwrite ของ Discord เสมอ
 *   → เข้าห้องที่ล็อกไว้ได้ แม้ Connect = false
 *   (เจ้าของเซิร์ฟเวอร์ก็เช่นกัน)
 *
 * listener นี้แก้ยังไง:
 *   ดักทุกครั้งที่มีคน "เข้า" ห้อง — ถ้าห้องนั้นยัง locked อยู่ใน DB ให้ disconnect ทันที
 *   การ disconnect ทำผ่าน "บอท" ไม่ขึ้นกับ permission ของ user → เตะ admin ออกได้ด้วย
 *   (ขอแค่บอทมีสิทธิ์ Move Members และ role บอทสูงกว่า)
 *
 * กัน infinite loop / race condition:
 *   - ทำงานเฉพาะตอน `newState.channel` เป็นห้องที่ถูกล็อก (สถานะ "เข้า/ย้ายเข้า" ห้อง)
 *   - ตอนเราสั่ง disconnect จะเกิด voiceStateUpdate อีกครั้งที่ newState.channel = null
 *     ("ออก" จากห้อง) → เงื่อนไข `if (!channel) return` ตัดจบทันที ไม่วนซ้ำ
 *   - ห่อ disconnect ด้วย .catch(() => {}) กัน error ถ้า member ออกไปเองก่อนแล้ว
 */
export async function enforceVoiceLock(
  _oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const channel = newState.channel;
  if (!channel) return; // ไม่ได้เข้าห้องไหน (หรือเพิ่งออก) — กัน loop
  if (!voiceLockDB.isLocked(channel.id)) return; // ห้องไม่ได้ล็อก
  await newState.member?.voice
    .disconnect("ห้องนี้ถูกล็อกอยู่")
    .catch(() => {}); // คนออกไปก่อนแล้วก็ไม่เป็นไร
}
