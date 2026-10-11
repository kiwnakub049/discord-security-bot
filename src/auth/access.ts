import { PermissionFlagsBits, type Client, type GuildMember } from "discord.js";
import { config } from "../config.js";

/**
 * ใครเข้า dashboard ได้ — ตัดสินจากยศในเซิร์ฟ Discord ล้วน ๆ ไม่มีรายชื่อบัญชีแยก
 *
 * ทำไมดูจากยศ: แอดมิน/mod ตัวจริงก็ถูกตั้งด้วยยศใน Discord อยู่แล้ว ถ้ามีรายชื่อแยกอีกชุด
 * วันที่ถอดยศใครออก ต้องจำมาลบบัญชีเว็บอีกที่ ซึ่งลืมกันประจำ — ผูกกับยศจุดเดียวจบ
 */

export type Role = "admin" | "mod";

export interface Access {
  role: Role;
  /** ชื่อผู้ใช้ Discord (ไม่ซ้ำกันทั้งระบบ) — ใช้ลงชื่อใน log ว่าใครกดอะไร */
  name: string;
}

/** หาสิทธิ์ของ Discord user ID — null = เข้าไม่ได้ */
export type AccessResolver = (userId: string) => Promise<Access | null>;

/** สิทธิ์จากยศของสมาชิก (ฟังก์ชันล้วน — เทสเรียกตรงได้) */
export function roleOf(
  member: Pick<GuildMember, "permissions"> & { roles: { cache: { has(id: string): boolean } } },
): Role | null {
  const has = (ids: string[]) => ids.some((id) => member.roles.cache.has(id));
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return "admin";
  if (has(config.dashboard.adminRoleIds)) return "admin";
  if (has(config.dashboard.modRoleIds)) return "mod";
  return null;
}

export function guildOf(client: Client) {
  const gid = process.env.GUILD_ID;
  return (gid ? client.guilds.cache.get(gid) : null) ?? client.guilds.cache.first() ?? null;
}

/**
 * ตัวตัดสินสิทธิ์จริง — อ่านยศจาก cache ของบอท (มี GuildMembers intent ยศอัปเดตสดอยู่แล้ว)
 * ไม่อยู่ใน cache ค่อย fetch ครั้งเดียว ไม่ได้ยิง Discord ทุก request
 */
export function discordAccess(client: Client): AccessResolver {
  return async (userId) => {
    const guild = guildOf(client);
    if (!guild) return null;
    const member =
      guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (!member) return null; // ออกจากเซิร์ฟไปแล้ว
    const role = roleOf(member);
    return role ? { role, name: member.user.username } : null;
  };
}

/** ไม่ได้ต่อ Discord (npm run web / เทส) — ไม่มีใครเข้าได้ เว้นแต่ตั้งตัวอื่นเข้ามาแทน */
export const noAccess: AccessResolver = async () => null;
