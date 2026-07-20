import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  getActivity,
  levelProgress,
  topByVoice,
  topByXp,
} from "../store/activityStore.js";

/** แปลงวินาทีเป็นข้อความอ่านง่าย เช่น "3 ชม. 24 นาที" */
function fmtVoice(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} ชม. ${m} นาที`;
  if (m > 0) return `${m} นาที`;
  return `${sec} วินาที`;
}

/** progress bar ตัวอักษร 10 ช่อง เช่น ▰▰▰▱▱▱▱▱▱▱ */
function bar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

/* ─── /rank — ดูเลเวล/XP ของตัวเองหรือคนอื่น ─── */
export const rank = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("ดูเลเวล/XP (ของตัวเองหรือระบุสมาชิก)")
    .addUserOption((o) =>
      o.setName("member").setDescription("สมาชิกที่ต้องการดู (ไม่ระบุ = ตัวเอง)"),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser("member") ?? interaction.user;
    const a = getActivity(target.id);
    const p = levelProgress(a.xp);

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setAuthor({
        name: target.username,
        iconURL: target.displayAvatarURL({ size: 64 }),
      })
      .setTitle(`🏆 เลเวล ${p.level}`)
      .setDescription(
        `${bar(p.pct)}  ${p.xpIntoLevel.toLocaleString()}/${p.xpForNext.toLocaleString()} XP สู่เลเวล ${p.level + 1}`,
      )
      .addFields(
        { name: "XP รวม", value: a.xp.toLocaleString(), inline: true },
        { name: "ข้อความ", value: a.messages.toLocaleString(), inline: true },
        { name: "ห้องเสียง", value: fmtVoice(a.voiceSeconds), inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

/* ─── /leaderboard — อันดับ XP หรือเวลาห้องเสียง ─── */
export const leaderboard = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("ดูอันดับสมาชิก (XP หรือเวลาห้องเสียง)")
    .addStringOption((o) =>
      o
        .setName("by")
        .setDescription("จัดอันดับตาม (ไม่ระบุ = XP)")
        .addChoices(
          { name: "XP", value: "xp" },
          { name: "เวลาห้องเสียง", value: "voice" },
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const by = interaction.options.getString("by") === "voice" ? "voice" : "xp";
    const rows = by === "voice" ? topByVoice(10) : topByXp(10);

    if (!rows.length) {
      await interaction.editReply("ยังไม่มีข้อมูล activity เลย");
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = await Promise.all(
      rows.map(async (a, i) => {
        // ดึงชื่อ (best-effort) — ดึงไม่ได้ก็ใช้ id
        const name = await interaction.client.users
          .fetch(a.userId)
          .then((u) => u.username)
          .catch(() => a.userId);
        const stat =
          by === "voice"
            ? fmtVoice(a.voiceSeconds)
            : `${a.xp.toLocaleString()} XP`;
        return `${medals[i] ?? `**${i + 1}.**`} **${name}** — LV.${a.level} · ${stat}`;
      }),
    );

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(by === "voice" ? "🏆 อันดับเวลาห้องเสียง" : "🏆 อันดับ XP")
      .setDescription(lines.join("\n"))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
