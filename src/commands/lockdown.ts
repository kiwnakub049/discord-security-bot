import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { logEvent } from "../utils/logger.js";

export const lock = {
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("ล็อกทุกห้อง: ปิดการส่งข้อความของ @everyone ชั่วคราว")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await setLockState(interaction, false);
  },
};

export const unlock = {
  data: new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("ปลดล็อกทุกห้อง: คืนสิทธิ์ส่งข้อความของ @everyone")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await setLockState(interaction, true);
  },
};

async function setLockState(
  interaction: ChatInputCommandInteraction,
  allowSend: boolean,
): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const everyone = interaction.guild.roles.everyone;
  const channels = interaction.guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildText,
  );

  let ok = 0;
  let fail = 0;
  for (const channel of channels.values()) {
    try {
      await channel.permissionOverwrites.edit(everyone, {
        SendMessages: allowSend ? null : false,
      });
      ok++;
    } catch {
      fail++;
    }
  }

  const verb = allowSend ? "ปลดล็อก" : "ล็อก";
  await interaction.editReply(
    `${verb}สำเร็จ ${ok} ห้อง${fail ? ` (พลาด ${fail} ห้อง — เช็คสิทธิ์บอท)` : ""}`,
  );
  await logEvent(interaction.client, allowSend ? "info" : "alert", "system", "system_lock", `${verb}เซิร์ฟเวอร์ (manual)`, [
    { name: "โดย", value: interaction.user.tag },
    { name: "ห้องที่สำเร็จ", value: `${ok}` },
  ]);
}
