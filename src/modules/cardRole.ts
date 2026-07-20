import type { Guild, GuildMember } from "discord.js";
import { config } from "../config.js";
import { getMember } from "../idcard/members.js";

/**
 * ซิงค์ role "มีบัตรประจำตัว":
 *  - มีบัตร แต่ยังไม่มี role  -> ใส่ role
 *  - ไม่มีบัตร แต่มี role     -> เอา role ออก
 */
export async function syncCardRole(member: GuildMember): Promise<void> {
  const roleId = config.cardRoleId;
  if (!roleId || member.user.bot) return;
  const hasCard = Boolean(getMember(member.id));
  const hasRole = member.roles.cache.has(roleId);
  try {
    if (hasCard && !hasRole) await member.roles.add(roleId);
    else if (!hasCard && hasRole) await member.roles.remove(roleId);
  } catch {
    // บอทไม่มีสิทธิ์ หรือ role บอทต่ำกว่า
  }
}

/** เวอร์ชันที่ fetch member เองจาก id (ใช้หลัง register/issue) */
export async function syncCardRoleById(
  guild: Guild | null,
  userId: string,
): Promise<void> {
  if (!guild) return;
  try {
    await syncCardRole(await guild.members.fetch(userId));
  } catch {
    // member ไม่อยู่ในเซิร์ฟเวอร์
  }
}

/** เช็คทุกคนในเซิร์ฟเวอร์ (สำหรับคำสั่ง /sync-cardroles) */
export async function syncAllCardRoles(
  guild: Guild,
): Promise<{ added: number; removed: number; total: number }> {
  const roleId = config.cardRoleId;
  let added = 0;
  let removed = 0;
  if (!roleId) return { added, removed, total: 0 };
  const members = await guild.members.fetch();
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const hasCard = Boolean(getMember(member.id));
    const hasRole = member.roles.cache.has(roleId);
    try {
      if (hasCard && !hasRole) {
        await member.roles.add(roleId);
        added++;
      } else if (!hasCard && hasRole) {
        await member.roles.remove(roleId);
        removed++;
      }
    } catch {
      // ข้ามคนที่ทำไม่ได้
    }
  }
  return { added, removed, total: members.size };
}
