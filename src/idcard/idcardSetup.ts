import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from "discord.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMember, registerMember, updateMember } from "./members.js";
import { getCardImage } from "./cardCache.js";
import { syncCardRoleById } from "../modules/cardRole.js";
import { logEvent } from "../utils/logger.js";

export const IDCARD_BUTTON = "idcard_create";
export const IDCARD_MODAL = "idcard_modal";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * แบนเนอร์หัวพาเนล — แนบไฟล์ไปกับข้อความ ไม่ได้ใส่เป็น URL
 *
 * ลิงก์ CDN ของ Discord เดี๋ยวนี้เซ็นมาพร้อมวันหมดอายุ (พารามิเตอร์ ex=) ถ้าอ้าง URL ตรง ๆ
 * อีกไม่กี่วันพาเนลที่ปักไว้ในห้องจะกลายเป็นรูปแตกโดยไม่มีใครรู้ตัว
 * แนบเป็นไฟล์แล้วอ้างด้วย attachment:// ทำให้รูปอยู่กับข้อความนั้นถาวร
 */
export const PANEL_BANNER_NAME = "panel_banner.jpg";
const PANEL_BANNER_PATH = join(__dirname, "assets", PANEL_BANNER_NAME);

/** embed + ปุ่ม สำหรับวางในห้อง */
export function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🪪 บัตรประจำตัวสมาชิก")
    .setDescription("กดปุ่มด้านล่างเพื่อสร้าง/อัปเดตบัตรประจำตัวของคุณ")
    .setImage(`attachment://${PANEL_BANNER_NAME}`);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(IDCARD_BUTTON)
      .setLabel("สร้างบัตรประจำตัว")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🪪"),
  );
  const banner = new AttachmentBuilder(PANEL_BANNER_PATH, {
    name: PANEL_BANNER_NAME,
  });
  return { embeds: [embed], components: [row], files: [banner] };
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
  const bias = new TextInputBuilder()
    .setCustomId("bias")
    .setLabel("ไบแอส")
    .setPlaceholder("เช่น ชื่อศิลปิน/สมาชิกวงที่ชอบ (ไม่กรอกก็ได้)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(40);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(status),
    new ActionRowBuilder<TextInputBuilder>().addComponents(bias),
  );
  await interaction.showModal(modal);
}

/** กรอก modal เสร็จ -> ลงทะเบียน + ส่งบัตร (ส่วนตัว) */
export async function submitIdcard(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = interaction.fields.getTextInputValue("status").trim() || "-";
  const bias = interaction.fields.getTextInputValue("bias").trim() || "-";
  const user = interaction.user;
  const joinedAt = (interaction.member as GuildMember | null)?.joinedAt ?? null;

  registerMember(user.id, joinedAt, bias, status); // สร้างถ้ายังไม่มี
  const card = updateMember(user.id, { status, bias }) ?? getMember(user.id);
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
