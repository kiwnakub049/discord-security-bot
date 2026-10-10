import type { GuildMember } from "discord.js";
import { config } from "../config.js";
import { addWarning } from "./warningStore.js";
import { setMutePunishment } from "./mutePunishmentStore.js";

/**
 * เตือนสมาชิก + ส่ง DM แจ้งส่วนตัว + ลงโทษอัตโนมัติเมื่อถึงเกณฑ์
 * (ใช้ร่วมกันทั้ง slash command และ dashboard)
 */
export async function warnMember(
  member: GuildMember,
  moderatorId: string,
  moderatorTag: string,
  reason: string,
): Promise<{
  count: number;
  actionMsg: string;
  level: "warn" | "alert";
  dmSent: boolean;
}> {
  const { count } = addWarning(member.id, moderatorId, moderatorTag, reason);

  const esc = config.warnings.escalation.find((e) => e.count === count);
  const hrs = esc?.ms ? Math.round(esc.ms / 3_600_000) : 0;

  // เวลาสิ้นสุดโทษ (mute/timeout) — ใช้ทั้งใน DM, การบันทึกโทษ และ log ให้ตรงกันเป๊ะ
  const deadline =
    (esc?.action === "mute" || esc?.action === "timeout") && esc.ms
      ? Date.now() + esc.ms
      : 0;
  // Discord แปลง <t:วินาที:R> เป็นนับถอยหลังสด ("อีก ~1 ชม.") ในแอปของผู้ใช้เอง
  // ไม่ต้อง edit ข้อความ — คนโดนเปิด DM ดูเวลาที่เหลือได้ตลอด
  const deadlineSec = Math.floor(deadline / 1000);
  const countdown = deadline
    ? ` — ปลดให้ <t:${deadlineSec}:R>`
    : "";

  let punishText = "";
  let actionMsg = "";
  let level: "warn" | "alert" = "warn";
  if (esc?.action === "mute" && esc.ms) {
    punishText = `ถูกปิดไมค์ (ไมค์แดง) ${hrs} ชม.`;
  } else if (esc?.action === "timeout" && esc.ms) {
    punishText = `ถูกระงับการพูด (timeout) ${hrs} ชม.`;
  } else if (esc?.action === "ban") {
    punishText = "ถูกแบนออกจากเซิร์ฟเวอร์";
  }

  // ส่ง DM ก่อนลงโทษ (เผื่อโดนแบน/kick จะ DM ไม่ได้)
  let dmSent = false;
  try {
    await member.send(
      `⚠️ คุณถูกเตือนในเซิร์ฟเวอร์ **${member.guild.name}**\n` +
        `เหตุผล: ${reason}\n` +
        `จำนวนเตือนสะสม: **${count}** ครั้ง` +
        (punishText ? `\n\n🚨 ผลที่ตามมา: **${punishText}**` : "") +
        // นับถอยหลังสด ๆ ให้คนโดน (เฉพาะโทษที่มีกำหนดปลด)
        (deadline
          ? `\n⏳ ปลดให้ <t:${deadlineSec}:R> (<t:${deadlineSec}:f>)`
          : ""),
    );
    dmSent = true;
  } catch {
    // ผู้ใช้ปิด DM หรือบล็อกบอท
  }

  // ลงโทษอัตโนมัติ
  if (esc) {
    try {
      if (esc.action === "mute" && esc.ms) {
        // บันทึกโทษก่อนเสมอ — ระบบบังคับ (muteEnforce) จะดูแลต่อ: ปิดไมค์ทันทีที่เข้าห้อง
        // ปิดกลับถ้ามีคนปลด และปลดให้เองเมื่อครบเวลา แม้ตอนนี้จะยังไม่อยู่ในห้องเสียง
        const reason = `เตือนครบ ${count} ครั้ง`;
        setMutePunishment({
          userId: member.id,
          guildId: member.guild.id,
          until: deadline,
          reason,
        });
        if (member.voice.channel) {
          await member.voice.setMute(true, reason);
          actionMsg = `→ ลงโทษ: ไมค์แดง ${hrs} ชม.${countdown}`;
        } else {
          actionMsg = `→ ลงโทษ: ไมค์แดง ${hrs} ชม. (ยังไม่อยู่ห้องเสียง — จะปิดทันทีที่เข้า)${countdown}`;
        }
      } else if (esc.action === "timeout" && esc.ms) {
        await member.timeout(esc.ms, `เตือนครบ ${count} ครั้ง`);
        actionMsg = `→ ลงโทษ: timeout ${hrs} ชม.${countdown}`;
      } else if (esc.action === "ban") {
        await member.ban({ reason: `เตือนครบ ${count} ครั้ง` });
        actionMsg = "→ ลงโทษ: แบน";
        level = "alert";
      }
    } catch {
      actionMsg = "→ ⚠️ ลงโทษอัตโนมัติไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)";
    }
  }

  return { count, actionMsg, level, dmSent };
}
