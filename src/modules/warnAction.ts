import type { GuildMember } from "discord.js";
import { config } from "../config.js";
import { addWarning } from "./warningStore.js";

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
  let punishText = "";
  let actionMsg = "";
  let level: "warn" | "alert" = "warn";
  if (esc?.action === "timeout" && esc.ms) {
    punishText = `ถูกระงับการพูด (timeout) ${Math.round(esc.ms / 3_600_000)} ชม.`;
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
        (punishText ? `\n\n🚨 ผลที่ตามมา: **${punishText}**` : ""),
    );
    dmSent = true;
  } catch {
    // ผู้ใช้ปิด DM หรือบล็อกบอท
  }

  // ลงโทษอัตโนมัติ
  if (esc) {
    try {
      if (esc.action === "timeout" && esc.ms) {
        await member.timeout(esc.ms, `เตือนครบ ${count} ครั้ง`);
        actionMsg = `→ ลงโทษ: timeout ${Math.round(esc.ms / 3_600_000)} ชม.`;
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
