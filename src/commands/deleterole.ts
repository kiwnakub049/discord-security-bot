import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Role,
  type StringSelectMenuInteraction,
} from "discord.js";
import { logEvent } from "../utils/logger.js";

/**
 * /deleterole — ลบ role ในเซิร์ฟเวอร์ เลือกได้ 2 ทาง:
 *   • รันเปล่า ๆ  → ขึ้น dropdown ให้เลือก role (ไม่ต้องพิมพ์)
 *   • พิมพ์ค้นหา → autocomplete กรองตามชื่อ (เผื่อ role เกิน 25 ตัวที่ dropdown โชว์ได้)
 * ทั้งสองทางมีปุ่ม "ยืนยันลบ" คั่นก่อนเสมอ เพราะลบ role แล้วกู้คืนไม่ได้
 */

export const SELECT_ID = "delrole_select";
export const CONFIRM_PREFIX = "delrole_confirm:";
export const CANCEL_ID = "delrole_cancel";

/** role นี้บอทลบได้จริงไหม — ใช้ทั้งตอน list, autocomplete และตอนลบจริง */
export function canDelete(guild: Guild, role: Role): { ok: boolean; reason?: string } {
  if (role.id === guild.id) return { ok: false, reason: "ลบ @everyone ไม่ได้" };
  if (role.managed)
    return { ok: false, reason: "เป็น role ที่ระบบจัดการ (บอท/บูสต์/integration) ลบไม่ได้" };
  const me = guild.members.me;
  if (!me) return { ok: false, reason: "อ่านข้อมูลบอทเองไม่ได้" };
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
    return { ok: false, reason: "บอทไม่มีสิทธิ์ Manage Roles" };
  if (me.roles.highest.position <= role.position)
    return {
      ok: false,
      reason: `role ของบอทอยู่ต่ำกว่าหรือเท่ากับ "${role.name}" — ลากบอทขึ้นให้สูงกว่าก่อน`,
    };
  return { ok: true };
}

/** role ที่ลบได้จริง เรียง role สูงก่อน (เหมือนที่เห็นใน Discord) */
function deletableRoles(guild: Guild): Role[] {
  return [...guild.roles.cache.values()]
    .filter((r) => canDelete(guild, r).ok)
    .sort((a, b) => b.position - a.position);
}

/** dropdown เลือก role — null ถ้าไม่มี role ให้ลบเลย */
function roleMenu(guild: Guild): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const roles = deletableRoles(guild).slice(0, 25); // Discord จำกัด dropdown 25 ตัวเลือก
  if (!roles.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder("เลือก role ที่จะลบ…")
    .addOptions(
      roles.map((r) => ({
        label: r.name.slice(0, 100),
        description: `${r.members.size} คนถืออยู่`.slice(0, 100),
        value: r.id,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** ปุ่มยืนยัน/ยกเลิก — ผูก role id ไว้ใน customId ของปุ่มยืนยัน */
function confirmRow(roleId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_PREFIX}${roleId}`)
      .setLabel("ยืนยันลบ")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🗑️"),
    new ButtonBuilder()
      .setCustomId(CANCEL_ID)
      .setLabel("ยกเลิก")
      .setStyle(ButtonStyle.Secondary),
  );
}

/** ข้อความสรุปก่อนยืนยัน */
function confirmText(role: Role): string {
  return (
    `⚠️ ยืนยันลบ role **${role.name}** ?\n` +
    `มีคนถืออยู่ **${role.members.size}** คน · สี ${role.hexColor}\n` +
    `_ลบแล้วกู้คืนไม่ได้ — คนที่ถือ role นี้จะเสียสิทธิ์ที่ผูกไว้ทันที_`
  );
}

/** ลบจริง + log — ใช้ร่วมกันทั้ง flow ปุ่มและ (เผื่อ) เรียกที่อื่น */
async function doDelete(
  guild: Guild,
  roleId: string,
  actorTag: string,
  actorId: string,
): Promise<{ ok: boolean; message: string }> {
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, message: "❌ ไม่พบ role นี้แล้ว (อาจถูกลบไปก่อน)" };
  const check = canDelete(guild, role);
  if (!check.ok) return { ok: false, message: `❌ ลบ "${role.name}" ไม่ได้ — ${check.reason}` };

  // เก็บ snapshot ก่อนลบ เพราะหลังลบ object จะไม่มีข้อมูลให้ดึง
  const snap = { name: role.name, id: role.id, members: role.members.size, color: role.hexColor };
  try {
    await role.delete(`ลบโดย ${actorTag} ผ่าน /deleterole`);
  } catch (err) {
    console.error("ลบ role ไม่สำเร็จ:", err);
    return { ok: false, message: "❌ ลบไม่สำเร็จ — เช็คสิทธิ์บอท (Manage Roles) และลำดับ role" };
  }

  await logEvent(guild.client, "warn", "audit", "audit_role", "ลบ role (ผ่าน /deleterole)", [
    { name: "Role", value: `${snap.name} (${snap.id})` },
    { name: "คนที่เคยถือ", value: `${snap.members} คน` },
    { name: "สี", value: snap.color },
    { name: "โดย", value: `${actorTag} (${actorId})` },
  ]);
  return {
    ok: true,
    message: `🗑️ ลบ role **${snap.name}** แล้ว (มีคนถืออยู่ ${snap.members} คน)`,
  };
}

/** เลือกจาก dropdown → โชว์ปุ่มยืนยัน */
export async function handleRoleSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  const roleId = interaction.values[0] ?? "";
  const role = guild.roles.cache.get(roleId);
  if (!role) {
    await interaction.update({ content: "❌ ไม่พบ role นี้แล้ว", components: [] });
    return;
  }
  const check = canDelete(guild, role);
  if (!check.ok) {
    await interaction.update({ content: `❌ ลบไม่ได้ — ${check.reason}`, components: [] });
    return;
  }
  await interaction.update({
    content: confirmText(role),
    components: [confirmRow(roleId)],
  });
}

/** กดปุ่มยืนยัน/ยกเลิก */
export async function handleRoleButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === CANCEL_ID) {
    await interaction.update({ content: "ยกเลิกแล้ว ไม่มีอะไรถูกลบ", components: [] });
    return;
  }
  if (!interaction.customId.startsWith(CONFIRM_PREFIX)) return;
  const guild = interaction.guild;
  if (!guild) return;
  // กันคลิกโดยคนไม่มีสิทธิ์ (ปุ่มอยู่ใน ephemeral เห็นเฉพาะคนสั่งอยู่แล้ว แต่กันไว้อีกชั้น)
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: "❌ ต้องมีสิทธิ์ Manage Roles", flags: MessageFlags.Ephemeral });
    return;
  }
  const roleId = interaction.customId.slice(CONFIRM_PREFIX.length);
  const res = await doDelete(guild, roleId, interaction.user.tag, interaction.user.id);
  await interaction.update({ content: res.message, components: [] });
}

export const deleteRole = {
  data: new SlashCommandBuilder()
    .setName("deleterole")
    .setDescription("ลบ role ในเซิร์ฟเวอร์ (รันเปล่าเพื่อเลือกจาก dropdown)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption((o) =>
      o
        .setName("role")
        .setDescription("พิมพ์ค้นหา role (เว้นว่างไว้เพื่อเลือกจาก dropdown)")
        .setRequired(false)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.respond([]);
      return;
    }
    const q = interaction.options.getFocused().toLowerCase();
    const choices = deletableRoles(guild)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((r) => ({
        name: `${r.name} · ${r.members.size} คน`.slice(0, 100),
        value: r.id,
      }));
    await interaction.respond(choices);
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleArg = interaction.options.getString("role");

    // พิมพ์/เลือกมาแล้ว → ตรงไปหน้ายืนยัน
    if (roleArg) {
      const id = /\d{17,20}/.exec(roleArg)?.[0] ?? roleArg;
      const role = guild.roles.cache.get(id);
      if (!role) {
        await interaction.editReply("❌ ไม่พบ role นี้ — เลือกจากรายการที่ขึ้นให้ตอนพิมพ์");
        return;
      }
      const check = canDelete(guild, role);
      if (!check.ok) {
        await interaction.editReply(`❌ ลบ "${role.name}" ไม่ได้ — ${check.reason}`);
        return;
      }
      await interaction.editReply({ content: confirmText(role), components: [confirmRow(role.id)] });
      return;
    }

    // รันเปล่า → โชว์ dropdown ให้เลือก
    const menu = roleMenu(guild);
    if (!menu) {
      await interaction.editReply("ℹ️ ไม่มี role ที่บอทลบได้ในตอนนี้ (อาจติดลำดับ role หรือเป็น role ระบบทั้งหมด)");
      return;
    }
    const total = deletableRoles(guild).length;
    await interaction.editReply({
      content:
        `เลือก role ที่จะลบจากรายการด้านล่าง` +
        (total > 25 ? `\n_(มี ${total} role ที่ลบได้ · dropdown โชว์ 25 อันดับบน — เกินนั้นพิมพ์ชื่อค้นหาแทน)_` : ""),
      components: [menu],
    });
  },
};
