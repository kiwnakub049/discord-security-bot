import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { config } from "../config.js";
import { addWarning, clearWarnings, getWarnings } from "../modules/warningStore.js";
import { warnMember } from "../modules/warnAction.js";
import { logEvent } from "../utils/logger.js";

/* ─── /warn ─── */
export const warn = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("เตือนสมาชิก (เตือนครบจำนวนจะลงโทษอัตโนมัติ)")
    .addUserOption((o) =>
      o.setName("user").setDescription("สมาชิกที่จะเตือน").setRequired(true),
    )
    .addStringOption((o) => o.setName("reason").setDescription("เหตุผล"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!config.warnings.enabled) {
      await interaction.reply({ content: "ระบบเตือนปิดอยู่", ephemeral: true });
      return;
    }
    await interaction.deferReply();
    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "ไม่ระบุเหตุผล";
    const member = interaction.options.getMember("user") as GuildMember | null;

    let count: number;
    let actionMsg = "";
    let level: "warn" | "alert" = "warn";
    let dmNote = "";
    if (member) {
      const r = await warnMember(
        member,
        interaction.user.id,
        interaction.user.tag,
        reason,
      );
      count = r.count;
      actionMsg = r.actionMsg;
      level = r.level;
      dmNote = r.dmSent ? "\n📨 แจ้งทาง DM แล้ว" : "\n(ส่ง DM ไม่ได้ — ผู้ใช้ปิด DM)";
    } else {
      // ไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว — บันทึกเตือนอย่างเดียว
      count = addWarning(target.id, interaction.user.id, interaction.user.tag, reason).count;
    }

    await interaction.editReply(
      `⚠️ เตือน **${target.tag}** แล้ว (เตือนครั้งที่ **${count}**)\nเหตุผล: ${reason}${actionMsg ? `\n${actionMsg}` : ""}${dmNote}`,
    );
    await logEvent(
      interaction.client,
      level,
      "security",
      "security_warn",
      "เตือนสมาชิก",
      [
        { name: "User", value: `${target.tag} (${target.id})` },
        { name: "จำนวนเตือน", value: `${count}` },
        { name: "โดย", value: interaction.user.tag },
        { name: "เหตุผล", value: reason },
        ...(actionMsg ? [{ name: "ผล", value: actionMsg }] : []),
      ],
    );
  },
};

/* ─── /warnings ─── */
export const warnings = {
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("ดูประวัติการเตือนของสมาชิก")
    .addUserOption((o) =>
      o.setName("user").setDescription("สมาชิกที่ต้องการดู").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser("user", true);
    const list = getWarnings(target.id);
    if (!list.length) {
      await interaction.editReply(`✅ **${target.tag}** ไม่มีประวัติเตือน`);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(`⚠️ ประวัติเตือน: ${target.tag}`)
      .setDescription(
        list
          .map(
            (w) =>
              `**#${w.id}** • ${new Date(w.timestamp).toLocaleString("th-TH", { hour12: false })}\nเหตุผล: ${w.reason} — โดย ${w.moderatorTag}`,
          )
          .join("\n\n"),
      )
      .setFooter({ text: `รวม ${list.length} ครั้ง` });
    await interaction.editReply({ embeds: [embed] });
  },
};

/* ─── /clearwarnings ─── */
export const clearwarnings = {
  data: new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("[Admin] ล้างประวัติเตือนของสมาชิก")
    .addUserOption((o) =>
      o.setName("user").setDescription("สมาชิกที่จะล้างเตือน").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser("user", true);
    const n = clearWarnings(target.id);
    await interaction.editReply(
      n > 0
        ? `🧹 ล้างเตือน ${n} ครั้งของ **${target.tag}** แล้ว`
        : `**${target.tag}** ไม่มีเตือนให้ลบ`,
    );
    if (n > 0) {
      await logEvent(
        interaction.client,
        "info",
        "security",
        "security_warn",
        "ล้างประวัติเตือน",
        [
          { name: "User", value: `${target.tag} (${target.id})` },
          { name: "ลบ", value: `${n} ครั้ง` },
          { name: "โดย", value: interaction.user.tag },
        ],
      );
    }
  },
};
