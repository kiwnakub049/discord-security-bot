import { AuditLogEvent, type Guild } from "discord.js";
import { config } from "../config.js";
import { db } from "../store/db.js";
import { deleteMember } from "../idcard/members.js";
import { deleteActivity } from "../store/activityStore.js";
import { invalidateCard } from "../idcard/cardCache.js";
import { clearWarnings, getWarnings } from "./warningStore.js";
import { clearMutePunishment, getActiveMute } from "./mutePunishmentStore.js";

/**
 * เหตุผลที่ "ควรเก็บข้อมูลไว้" ตอนคนออกจากเซิร์ฟเวอร์ — null = ออกเองสะอาด ๆ (ลบได้)
 *
 * ถือว่าถูกแอดมินจัดการเมื่อ: ถูกแบน, ถูกเตะ (kick), มีประวัติเตือน, หรือกำลังโดนไมค์แดง
 * เช็ค record ในเครื่องก่อน (ไว/ไม่ต้องสิทธิ์) แล้วค่อยถาม Discord (แบน/audit log)
 */
export async function moderationHoldReason(
  guild: Guild,
  userId: string,
): Promise<string | null> {
  // 1) record ในเครื่อง — เร็ว ไม่ต้องเรียก API
  if (getWarnings(userId).length > 0) return "มีประวัติเตือน";
  if (getActiveMute(userId)) return "กำลังโดนไมค์แดง";

  // 2) ถูกแบนอยู่ไหม (ban ทำให้เกิด guildMemberRemove เหมือนกัน)
  try {
    await guild.bans.fetch(userId); // เจอ = ถูกแบน, ไม่เจอ = throw
    return "ถูกแบน";
  } catch {
    // ไม่ถูกแบน — ไปเช็คต่อ
  }

  // 3) เพิ่งถูกเตะ (kick) — ดูจาก audit log รายการล่าสุด (ต้องมีสิทธิ์ View Audit Log)
  try {
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberKick,
      limit: 6,
    });
    const hit = logs.entries.find(
      (e) => e.targetId === userId && Date.now() - e.createdTimestamp < 15_000,
    );
    if (hit) return "ถูกเตะ (kick)";
  } catch {
    // อ่าน audit log ไม่ได้ (สิทธิ์?) — ข้าม
  }

  return null;
}

/**
 * ลบข้อมูลทั้งหมดของ user 1 คน — ใช้ตอนออกจากเซิร์ฟเวอร์ (guildMemberRemove)
 *
 * ครอบคลุมทุกตารางที่ผูกกับ user_id + ไฟล์รูปบัตร:
 *   members (บัตร) · warnings (เตือน) · activity (XP) · mute_punishments (ไมค์แดง) · รูปบัตร
 * ai_verdicts (ข้อความ+คำตัดสิน) ลบเฉพาะเมื่อ config.privacy.purgeAiVerdicts = true
 * เพราะปกติเก็บไว้เป็นข้อมูลเทรนโมเดล
 *
 * จงใจ "ไม่" แตะตาราง logs — เป็น audit trail ของเหตุการณ์ (ลบเองตาม retentionDays อยู่แล้ว)
 * ถ้าลบตาม user จะเสียประวัติการสืบสวนย้อนหลัง
 */

export interface PurgeResult {
  member: boolean;
  warnings: number;
  activity: boolean;
  mute: boolean;
  verdicts: number;
}

export function purgeUserData(userId: string): PurgeResult {
  const warnings = clearWarnings(userId);
  const member = deleteMember(userId);
  const activity = deleteActivity(userId);
  clearMutePunishment(userId);
  invalidateCard(userId); // ลบไฟล์ data/cards/<id>.png + .sig
  const mute = true; // clearMutePunishment ไม่คืนค่า — ถือว่าเคลียร์แล้ว

  let verdicts = 0;
  if (config.privacy.purgeAiVerdicts) {
    verdicts = db
      .prepare("DELETE FROM ai_verdicts WHERE user_id = ?")
      .run(userId).changes;
  }

  return { member, warnings, activity, mute, verdicts };
}

/** มีอะไรถูกลบจริงบ้างไหม (ไว้ตัดสินใจว่าจะ log หรือไม่) */
export function purgedAnything(r: PurgeResult): boolean {
  return r.member || r.warnings > 0 || r.activity || r.verdicts > 0;
}
