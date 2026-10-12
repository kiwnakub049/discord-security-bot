import { Events, type GuildMember, type PartialGuildMember } from "discord.js";
import { config } from "../config.js";
import { logMemberLeave } from "../modules/serverLog.js";
import { closeSuspiciousOnLeave } from "../modules/antiRaid.js";
import {
  moderationHoldReason,
  purgeUserData,
  purgedAnything,
} from "../modules/userPurge.js";
import { logEvent } from "../utils/logger.js";

export const name = Events.GuildMemberRemove;

export async function execute(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  await logMemberLeave(member);
  // ทำก่อนเช็ค purgeOnLeave — การ์ดค้างต้องปิดเสมอ ไม่ว่าจะลบข้อมูลหรือไม่
  closeSuspiciousOnLeave(member.id);

  // ออกจากเซิร์ฟเวอร์ → ลบข้อมูลของคนนั้นทิ้ง (ถ้าเปิดไว้)
  if (!config.privacy.purgeOnLeave) return;

  // แต่ถ้าถูกแอดมินจัดการ (แบน/เตะ/มีประวัติเตือน/ไมค์แดง) → เก็บข้อมูลไว้เดิม
  if (config.privacy.keepIfModerated) {
    const hold = await moderationHoldReason(member.guild, member.id);
    if (hold) {
      const tag = member.user?.tag ?? member.id;
      await logEvent(member.client, "info", "member", "member_purge_skip", "เก็บข้อมูลผู้ใช้ไว้ (ออกเพราะโดนแอดมินจัดการ)", [
        { name: "User", value: `${tag} (${member.id})` },
        { name: "เหตุผล", value: hold },
      ]);
      return;
    }
  }

  const res = purgeUserData(member.id);
  if (!purgedAnything(res)) return; // ไม่มีข้อมูลอะไรให้ลบ — ไม่ต้องรก log

  const tag = member.user?.tag ?? member.id;
  const parts = [
    res.member ? "บัตร" : null,
    res.warnings > 0 ? `เตือน ${res.warnings}` : null,
    res.activity ? "XP" : null,
    res.verdicts > 0 ? `verdict ${res.verdicts}` : null,
  ].filter(Boolean);
  await logEvent(member.client, "info", "member", "member_purge", "ลบข้อมูลผู้ใช้ (ออกจากเซิร์ฟเวอร์)", [
    { name: "User", value: `${tag} (${member.id})` },
    { name: "ลบแล้ว", value: parts.length ? parts.join(" · ") : "รูปบัตร/โทษที่ค้าง" },
  ]);
}
