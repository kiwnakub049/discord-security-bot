import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type User,
} from "discord.js";
import { getCardImage } from "../idcard/cardCache.js";
import { buildPanel } from "../idcard/idcardSetup.js";
import { addPanel } from "../idcard/panelStore.js";
import {
  checkCardRoleSetup,
  syncAllCardRoles,
  syncCardRoleById,
  type CardRoleResult,
} from "../modules/cardRole.js";

/** ต่อท้ายข้อความตอบกลับเมื่อออกบัตรได้แต่ให้ role ไม่ได้ */
function roleFailNote(r: CardRoleResult): string {
  return r === "failed"
    ? "\n⚠️ แต่ยังให้ยศไม่ได้ — แจ้งแอดมินให้เช็คลำดับ role ของบอท"
    : "";
}
import {
  getMember,
  registerMember,
  updateMember,
  type MemberCard,
} from "../idcard/members.js";
import { logEvent } from "../utils/logger.js";

const AVATAR_OPTS = { extension: "png" as const, size: 256 };

// ตัวเลือกสถานะความสัมพันธ์บนบัตร
const STATUS_CHOICES = [
  { name: "โสด", value: "โสด" },
  { name: "มีคนคุย", value: "มีคนคุย" },
  { name: "มีแฟนแล้ว", value: "มีแฟนแล้ว" },
  { name: "อกหัก", value: "อกหัก" },
];

async function cardAttachment(user: User, card: MemberCard) {
  const buf = await getCardImage(
    user.id,
    user.username,
    user.displayAvatarURL(AVATAR_OPTS),
    card,
  );
  return new AttachmentBuilder(buf, { name: "idcard.png" });
}

function joinedAtOf(member: unknown): Date | null {
  return (member as GuildMember | null)?.joinedAt ?? null;
}

const idLabel = (card: MemberCard) =>
  `VL-${String(card.member_number).padStart(4, "0")}`;

/* ─── /register ─── */
export const register = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("ลงทะเบียนรับบัตรประจำตัว")
    .addStringOption((o) =>
      o.setName("status").setDescription("สถานะความสัมพันธ์").addChoices(...STATUS_CHOICES),
    )
    .addStringOption((o) =>
      o.setName("bias").setDescription("ไบแอสของคุณ").setMaxLength(40),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const biasOpt = interaction.options.getString("bias");
    const statusOpt = interaction.options.getString("status");
    let card = registerMember(
      interaction.user.id,
      joinedAtOf(interaction.member),
      biasOpt ?? "-",
      statusOpt ?? "-",
    );
    // registerMember คืน row เดิมโดยไม่อัปเดตถ้าลงทะเบียนอยู่แล้ว —
    // อัปเดตเฉพาะฟิลด์ที่ผู้ใช้ระบุมาจริง (กันเผลอทับค่าเดิมเป็น "-")
    const patch: { bias?: string; status?: string } = {};
    if (biasOpt !== null) patch.bias = biasOpt;
    if (statusOpt !== null) patch.status = statusOpt;
    if (Object.keys(patch).length > 0) {
      card = updateMember(interaction.user.id, patch) ?? card;
    }
    const roleResult = await syncCardRoleById(interaction.guild, interaction.user.id);
    const note = roleFailNote(roleResult);
    await interaction.editReply({
      content: `✅ ลงทะเบียนสำเร็จ! หมายเลขของคุณคือ **${idLabel(card)}**${note}`,
      files: [await cardAttachment(interaction.user, card)],
    });
    await logEvent(interaction.client, "info", "member", "member_register", "ลงทะเบียนรับบัตร", [
      { name: "User", value: `${interaction.user.tag} (${interaction.user.id})` },
      { name: "หมายเลข", value: idLabel(card) },
    ]);
  },
};

/* ─── /idcard ─── */
export const idcard = {
  data: new SlashCommandBuilder()
    .setName("idcard")
    .setDescription("แสดงบัตรประจำตัว (ของตัวเองหรือระบุสมาชิก)")
    .addUserOption((o) =>
      o.setName("member").setDescription("สมาชิกที่ต้องการดูบัตร (ไม่ระบุ = ของตัวเอง)"),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const target = interaction.options.getUser("member") ?? interaction.user;
    const joinedAt =
      joinedAtOf(interaction.options.getMember("member")) ??
      (target.id === interaction.user.id ? joinedAtOf(interaction.member) : null);
    const card = registerMember(target.id, joinedAt); // get-or-create
    await interaction.editReply({ files: [await cardAttachment(target, card)] });
  },
};

/* ─── /setbias ─── */
export const setbias = {
  data: new SlashCommandBuilder()
    .setName("setbias")
    .setDescription("อัปเดต Bias บนบัตรของคุณ")
    .addStringOption((o) =>
      o.setName("bias").setDescription("ชื่อไบแอสใหม่").setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const bias = interaction.options.getString("bias", true);
    const card = updateMember(interaction.user.id, { bias });
    if (!card) {
      await interaction.editReply("❌ ยังไม่ได้ลงทะเบียน ใช้ `/register` ก่อนนะ");
      return;
    }
    await interaction.editReply({
      content: `✅ อัปเดต Bias เป็น **${bias}** แล้ว`,
      files: [await cardAttachment(interaction.user, card)],
    });
  },
};

/* ─── /setstatus ─── */
export const setstatus = {
  data: new SlashCommandBuilder()
    .setName("setstatus")
    .setDescription("อัปเดตสถานะความสัมพันธ์บนบัตร")
    .addStringOption((o) =>
      o
        .setName("status")
        .setDescription("เลือกสถานะ")
        .setRequired(true)
        .addChoices(...STATUS_CHOICES),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const status = interaction.options.getString("status", true);
    const card = updateMember(interaction.user.id, { status });
    if (!card) {
      await interaction.editReply("❌ ยังไม่ได้ลงทะเบียน ใช้ `/register` ก่อนนะ");
      return;
    }
    await interaction.editReply({
      content: `✅ อัปเดต Status เป็น **${status}** แล้ว`,
      files: [await cardAttachment(interaction.user, card)],
    });
  },
};

/* ─── /setup-idcard (admin) — วาง embed + ปุ่มในห้องนี้ ─── */
export const setupIdcard = {
  data: new SlashCommandBuilder()
    .setName("setup-idcard")
    .setDescription("[Admin] วาง embed + ปุ่มสร้างบัตรในห้องนี้")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const ch = interaction.channel;
    if (!ch || !ch.isSendable()) {
      await interaction.reply({ content: "❌ ส่งข้อความในห้องนี้ไม่ได้", flags: MessageFlags.Ephemeral });
      return;
    }
    const panel = await ch.send(buildPanel());
    // จำแผงไว้ให้ลูปไล่สีขอบ embed หาเจอ (แม้หลัง restart)
    if (interaction.guildId) {
      addPanel({
        guildId: interaction.guildId,
        channelId: ch.id,
        messageId: panel.id,
      });
    }
    await interaction.reply({ content: "✅ วางปุ่มสร้างบัตรในห้องนี้แล้ว (ขอบสีจะไล่เปลี่ยนไปเรื่อย ๆ)", flags: MessageFlags.Ephemeral });
  },
};

/* ─── /sync-cardroles (admin) — เช็ค role บัตรของทุกคน ─── */
export const syncCardRoles = {
  data: new SlashCommandBuilder()
    .setName("sync-cardroles")
    .setDescription("[Admin] เช็ค role บัตรของทุกคน (มีบัตร=ได้ role, ไม่มี=เอาออก)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await syncAllCardRoles(interaction.guild);
    // นับ failed แยกไว้ ไม่งั้น "เพิ่ม 0 คน" อ่านได้ทั้งว่าทุกคนมีอยู่แล้ว และว่าทำไม่สำเร็จเลยสักคน
    const problem = checkCardRoleSetup(interaction.guild);
    await interaction.editReply(
      `✅ ซิงค์ role บัตรเสร็จ — เพิ่ม ${r.added} คน, เอาออก ${r.removed} คน` +
        (r.failed > 0 ? `, ❌ ไม่สำเร็จ ${r.failed} คน` : "") +
        ` (จากทั้งหมด ${r.total} คน)` +
        (problem ? `\n\n⚠️ ${problem}` : ""),
    );
  },
};

/* ─── /issue (admin) ─── */
export const issue = {
  data: new SlashCommandBuilder()
    .setName("issue")
    .setDescription("[Admin] ออกบัตรให้สมาชิก")
    .addUserOption((o) =>
      o.setName("member").setDescription("สมาชิกที่ต้องการออกบัตรให้").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const target = interaction.options.getUser("member", true);
    const card = registerMember(
      target.id,
      joinedAtOf(interaction.options.getMember("member")),
    );
    const roleResult = await syncCardRoleById(interaction.guild, target.id);
    const note = roleFailNote(roleResult);
    await interaction.editReply({
      content: `📋 ออกบัตรให้ **${target.username}** หมายเลข **${idLabel(card)}** แล้ว${note}`,
      files: [await cardAttachment(target, card)],
    });
    await logEvent(interaction.client, "info", "member", "member_issue", "แอดมินออกบัตร (issue)", [
      { name: "ผู้ทำ", value: interaction.user.tag },
      { name: "ให้", value: `${target.tag} (${target.id})` },
      { name: "หมายเลข", value: idLabel(card) },
    ]);
  },
};
