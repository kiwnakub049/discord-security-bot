import {
  AttachmentBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type User,
} from "discord.js";
import { getCardImage } from "../idcard/cardCache.js";
import { buildPanel } from "../idcard/idcardSetup.js";
import { syncAllCardRoles, syncCardRoleById } from "../modules/cardRole.js";
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
    await interaction.deferReply({ ephemeral: true });
    const bias = interaction.options.getString("bias") ?? "-";
    const status = interaction.options.getString("status") ?? "-";
    const card = registerMember(
      interaction.user.id,
      joinedAtOf(interaction.member),
      bias,
      status,
    );
    await syncCardRoleById(interaction.guild, interaction.user.id); // ให้ role มีบัตร
    await interaction.editReply({
      content: `✅ ลงทะเบียนสำเร็จ! หมายเลขของคุณคือ **${idLabel(card)}**`,
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
    await interaction.deferReply({ ephemeral: true });
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
    await interaction.deferReply({ ephemeral: true });
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
      await interaction.reply({ content: "❌ ส่งข้อความในห้องนี้ไม่ได้", ephemeral: true });
      return;
    }
    await ch.send(buildPanel());
    await interaction.reply({ content: "✅ วางปุ่มสร้างบัตรในห้องนี้แล้ว", ephemeral: true });
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
    await interaction.deferReply({ ephemeral: true });
    const r = await syncAllCardRoles(interaction.guild);
    await interaction.editReply(
      `✅ ซิงค์ role บัตรเสร็จ — เพิ่ม ${r.added} คน, เอาออก ${r.removed} คน (จากทั้งหมด ${r.total} คน)`,
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
    await syncCardRoleById(interaction.guild, target.id); // ให้ role มีบัตร
    await interaction.editReply({
      content: `📋 ออกบัตรให้ **${target.username}** หมายเลข **${idLabel(card)}** แล้ว`,
      files: [await cardAttachment(target, card)],
    });
    await logEvent(interaction.client, "info", "member", "member_issue", "แอดมินออกบัตร (issue)", [
      { name: "ผู้ทำ", value: interaction.user.tag },
      { name: "ให้", value: `${target.tag} (${target.id})` },
      { name: "หมายเลข", value: idLabel(card) },
    ]);
  },
};
