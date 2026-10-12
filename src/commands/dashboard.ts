import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { roleOf } from "../auth/access.js";
import { createLoginLink, LINK_TTL_MS } from "../auth/loginLink.js";

/* ─── /dashboard — ขอลิงก์เข้าเว็บ dashboard (login ผ่านแอป Discord ไม่ต้องใส่อะไรในเบราว์เซอร์) ─── */
export const dashboard = {
  data: new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("ขอลิงก์เข้า Undawn Dashboard (เฉพาะแอดมิน/mod · ใช้ได้ครั้งเดียว)"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // ephemeral เสมอ — ลิงก์นี้คือกุญแจเข้าเว็บ ห้ามคนอื่นในห้องเห็น
    const member = interaction.member as GuildMember | null;
    if (!member || typeof member.permissions === "string" || !roleOf(member)) {
      await interaction.reply({
        content: "คุณไม่มีสิทธิ์เข้า dashboard — ต้องมียศแอดมินหรือ mod",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const base = process.env.DASHBOARD_URL?.trim().replace(/\/+$/, "");
    if (!base) {
      await interaction.reply({
        content: "ยังไม่ได้ตั้ง DASHBOARD_URL ใน .env ของบอท",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const token = createLoginLink(interaction.user.id);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("เปิด Undawn Dashboard")
        .setURL(`${base}/auth/link?t=${token}`),
    );
    await interaction.reply({
      content:
        `ลิงก์เข้า dashboard ของคุณ — หมดอายุใน ${LINK_TTL_MS / 60_000} นาที ใช้ได้ครั้งเดียว อย่าส่งต่อให้ใคร\n` +
        "-# ถ้าอยากให้ค้าง login ในเบราว์เซอร์ปกติ ให้กดค้างที่ปุ่มแล้วเลือกเปิดในเบราว์เซอร์",
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },
};
