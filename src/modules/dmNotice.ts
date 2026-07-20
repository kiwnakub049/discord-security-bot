import type { GuildMember } from "discord.js";

/**
 * ส่ง DM แจ้งผู้ใช้เมื่อโดนลงโทษ — คืน true ถ้าส่งสำเร็จ (false = ผู้ใช้ปิด DM)
 */
type ActionKind = "ban" | "kick" | "timeout" | "spam";

export async function dmAction(
  member: GuildMember,
  action: ActionKind,
  reason?: string,
  durationMs?: number,
): Promise<boolean> {
  const g = member.guild.name;
  let body: string;
  switch (action) {
    case "ban":
      body = `🚫 คุณถูกแบนออกจากเซิร์ฟเวอร์ **${g}**`;
      break;
    case "kick":
      body = `👢 คุณถูกเตะออกจากเซิร์ฟเวอร์ **${g}**`;
      break;
    case "timeout":
      body = `🔇 คุณถูกระงับการพูด (timeout)${durationMs ? ` ${Math.round(durationMs / 60_000)} นาที` : ""} ในเซิร์ฟเวอร์ **${g}**`;
      break;
    case "spam":
      body = `🔇 คุณถูกระงับการพูดชั่วคราวในเซิร์ฟเวอร์ **${g}** เนื่องจากส่งข้อความถี่/ซ้ำ/แท็กเกินกำหนด`;
      break;
  }
  if (reason) body += `\nเหตุผล: ${reason}`;
  try {
    await member.send(body);
    return true;
  } catch {
    return false;
  }
}
