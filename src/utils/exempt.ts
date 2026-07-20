import { PermissionsBitField, type GuildMember } from "discord.js";
import { config } from "../config.js";

/**
 * เช็คว่า member นี้ควรได้รับการยกเว้นจากการตรวจสอบหรือไม่
 * ยกเว้นถ้า: เป็นบอท, อยู่ใน exempt list, หรือมีสิทธิ์ ManageGuild (admin/mod)
 */
export function isExempt(member: GuildMember | null): boolean {
  if (!member) return false;
  if (member.user.bot) return true;
  if (config.exemptUserIds.includes(member.id)) return true;
  if (member.roles.cache.some((r) => config.exemptRoleIds.includes(r.id)))
    return true;
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild))
    return true;
  return false;
}
