import {
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
} from "discord.js";
import { config } from "../config.js";
import { getMember } from "../idcard/members.js";
import { logEvent } from "../utils/logger.js";

/**
 * ซิงค์ role "มีบัตรประจำตัว":
 *  - มีบัตร แต่ยังไม่มี role  -> ใส่ role
 *  - ไม่มีบัตร แต่มี role     -> เอา role ออก
 *
 * ── ทำไมต้องคืนผลลัพธ์ ไม่ใช่กลืน error ทิ้ง ──
 * เดิมโค้ดนี้ catch แล้วไม่ทำอะไรเลย เวลา Discord ปฏิเสธ (role ของบอทอยู่ต่ำกว่า
 * role บัตร) คนกดสร้างบัตรจะเห็นข้อความ "✅ สร้างบัตรแล้ว" ทั้งที่ไม่ได้ role
 * และไม่มีร่องรอยใน log ให้ตามได้เลย — อาการจะเงียบจนกว่าจะมีคนสังเกตเอง
 */
export type CardRoleResult =
  | "added"
  | "removed"
  | "noop" // สถานะตรงอยู่แล้ว ไม่ต้องทำอะไร
  | "disabled" // ไม่ได้ตั้ง cardRoleId
  | "failed"; // Discord ปฏิเสธ — ดูรายละเอียดใน log

/** กันสแปม: เหตุผลเดิมซ้ำ ๆ ให้ log แค่ครั้งเดียวต่อช่วงเวลานี้ */
const WARN_EVERY_MS = 10 * 60 * 1000;
let lastWarnAt = 0;

async function warnOnce(
  client: Client,
  member: GuildMember,
  err: unknown,
): Promise<void> {
  const now = Date.now();
  if (now - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = now;

  const me = member.guild.members.me;
  const myPos = me?.roles.highest.position ?? -1;
  const role = member.guild.roles.cache.get(config.cardRoleId);
  const reason =
    role && myPos <= role.position
      ? `role ของบอท (${me?.roles.highest.name} ลำดับ ${myPos}) อยู่ต่ำกว่า role บัตร (${role.name} ลำดับ ${role.position}) — ต้องลาก role บอทขึ้นไปให้สูงกว่า`
      : (err instanceof Error ? err.message : String(err));

  await logEvent(
    client,
    "warn",
    "system",
    "cardrole_failed",
    "ให้ role บัตรประจำตัวไม่สำเร็จ",
    [
      { name: "สมาชิก", value: `${member.user.tag} (${member.id})` },
      { name: "role บัตร", value: role ? `${role.name} (${role.id})` : config.cardRoleId },
      { name: "สาเหตุ", value: reason },
    ],
  );
}

export async function syncCardRole(member: GuildMember): Promise<CardRoleResult> {
  const roleId = config.cardRoleId;
  if (!roleId || member.user.bot) return "disabled";
  const hasCard = Boolean(getMember(member.id));
  const hasRole = member.roles.cache.has(roleId);
  if (hasCard === hasRole) return "noop";
  try {
    if (hasCard) {
      await member.roles.add(roleId);
      return "added";
    }
    await member.roles.remove(roleId);
    return "removed";
  } catch (err) {
    await warnOnce(member.client, member, err);
    return "failed";
  }
}

/** เวอร์ชันที่ fetch member เองจาก id (ใช้หลัง register/issue) */
export async function syncCardRoleById(
  guild: Guild | null,
  userId: string,
): Promise<CardRoleResult> {
  if (!guild) return "disabled";
  try {
    return await syncCardRole(await guild.members.fetch(userId));
  } catch {
    return "failed"; // member ไม่อยู่ในเซิร์ฟเวอร์
  }
}

/** เช็คทุกคนในเซิร์ฟเวอร์ (สำหรับคำสั่ง /sync-cardroles) */
export async function syncAllCardRoles(
  guild: Guild,
): Promise<{ added: number; removed: number; failed: number; total: number }> {
  const roleId = config.cardRoleId;
  let added = 0;
  let removed = 0;
  let failed = 0;
  if (!roleId) return { added, removed, failed, total: 0 };
  const members = await guild.members.fetch();
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const r = await syncCardRole(member);
    if (r === "added") added++;
    else if (r === "removed") removed++;
    else if (r === "failed") failed++;
  }
  return { added, removed, failed, total: members.size };
}

/**
 * ตรวจตอนบอทออนไลน์ว่า "ให้ role บัตรได้จริงไหม" — ไม่ต้องรอให้มีคนกดสร้างบัตรก่อน
 *
 * Discord ไม่ยอมให้ใครแตะ role ที่อยู่สูงกว่าหรือเท่ากับ role สูงสุดของตัวเอง
 * ข้อนี้บังคับกับบอทที่มีสิทธิ์ Administrator ด้วย — สิทธิ์ไม่ช่วยข้ามลำดับ
 * ถ้าเช็คเฉพาะ permission จะผ่านฉลุยแล้วไปพังตอนใช้งานจริง
 *
 * @returns ข้อความปัญหา หรือ null ถ้าเรียบร้อยดี
 */
export function checkCardRoleSetup(guild: Guild): string | null {
  const roleId = config.cardRoleId;
  if (!roleId) return null; // ปิดฟีเจอร์ไว้ ไม่ใช่ปัญหา

  const role = guild.roles.cache.get(roleId);
  if (!role) return `ไม่พบ role บัตร (${roleId}) ในเซิร์ฟเวอร์นี้ — อาจถูกลบไปแล้ว`;

  const me = guild.members.me;
  if (!me) return "อ่านข้อมูล role ของบอทเองไม่ได้";

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
    return "บอทไม่มีสิทธิ์ Manage Roles";

  if (me.roles.highest.position <= role.position)
    return `role ของบอท "${me.roles.highest.name}" (ลำดับ ${me.roles.highest.position}) อยู่ต่ำกว่า "${role.name}" (ลำดับ ${role.position}) — ลาก role ของบอทขึ้นไปเหนือกว่าใน Server Settings > Roles`;

  return null;
}
