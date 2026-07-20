import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../config.js";

export const status = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("ดูสถานะระบบป้องกันที่เปิดอยู่")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const on = (b: boolean) => (b ? "🟢 เปิด" : "🔴 ปิด");
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🛡️ สถานะระบบป้องกัน")
      .addFields(
        {
          name: "Anti-raid",
          value: `${on(config.antiRaid.enabled)} — ${config.antiRaid.joinThreshold} คน/${config.antiRaid.joinWindowMs / 1000}s → ${config.antiRaid.action}`,
        },
        {
          name: "Anti-spam",
          value: `${on(config.antiSpam.enabled)} — ${config.antiSpam.maxMessages} ข้อความ/${config.antiSpam.windowMs / 1000}s, mention ≤ ${config.antiSpam.maxMentions}`,
        },
        {
          name: "Auto-mod",
          value: `${on(config.autoMod.enabled)} — invite:${config.autoMod.blockInvites ? "✓" : "✗"} phishing:${config.autoMod.blockPhishing ? "✓" : "✗"}`,
        },
        {
          name: "Log channel",
          value: config.logChannelId ? `<#${config.logChannelId}>` : "console เท่านั้น",
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
