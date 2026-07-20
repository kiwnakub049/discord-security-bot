import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from "discord.js";
import { getMember, registerMember, updateMember } from "./members.js";
import { getCardImage } from "./cardCache.js";
import { syncCardRoleById } from "../modules/cardRole.js";
import { logEvent } from "../utils/logger.js";

export const IDCARD_BUTTON = "idcard_create";
export const IDCARD_MODAL = "idcard_modal";

/** embed + ปุ่ม สำหรับวางในห้อง */
export function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🪪 บัตรประจำตัวสมาชิก")
    .setDescription("กดปุ่มด้านล่างเพื่อสร้าง/อัปเดตบัตรประจำตัวของคุณ");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(IDCARD_BUTTON)
      .setLabel("สร้างบัตรประจำตัว")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🪪"),
  );
  return { embeds: [embed], components: [row] };
}

/** กดปุ่ม -> เปิด modal ให้กรอก */
export async function showIdcardModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(IDCARD_MODAL)
    .setTitle("สร้างบัตรประจำตัว");
  const status = new TextInputBuilder()
    .setCustomId("status")
    .setLabel("สถานะ")
    .setPlaceholder("เช่น โสด / มีคนคุย / มีแฟนแล้ว / อกหัก")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(40);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(status),
  );
  await interaction.showModal(modal);
}

/** กรอก modal เสร็จ -> ลงทะเบียน + ส่งบัตร (ส่วนตัว) */
export async function submitIdcard(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const status = interaction.fields.getTextInputValue("status").trim() || "-";
  const user = interaction.user;
  const joinedAt = (interaction.member as GuildMember | null)?.joinedAt ?? null;

  registerMember(user.id, joinedAt, "-", status); // สร้างถ้ายังไม่มี
  const card = updateMember(user.id, { status }) ?? getMember(user.id);
  if (!card) {
    await interaction.editReply("❌ สร้างบัตรไม่สำเร็จ");
    return;
  }

  const buf = await getCardImage(
    user.id,
    user.username,
    user.displayAvatarURL({ extension: "png", size: 256 }),
    card,
  );
  await syncCardRoleById(interaction.guild, user.id); // มีบัตรแล้ว -> ให้ role
  await interaction.editReply({
    content: `✅ สร้างบัตรแล้ว! หมายเลข **VL-${String(card.member_number).padStart(4, "0")}**`,
    files: [new AttachmentBuilder(buf, { name: "idcard.png" })],
  });
  await logEvent(interaction.client, "info", "member", "member_register", "สร้างบัตรผ่านปุ่ม", [
    { name: "User", value: `${user.tag} (${user.id})` },
    { name: "Status", value: status },
  ]);
}
