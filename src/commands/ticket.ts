import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { openTicket } from "../modules/ticket.js";

/* ─── /ticket — สมาชิกส่งเรื่องถึงแอดมิน (ไปขึ้นคิวบน dashboard) ─── */
export const ticket = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("ส่งเรื่องถึงแอดมิน (มี ticket ค้างได้คนละ 1 เรื่อง)")
    .addStringOption((o) =>
      o.setName("topic").setDescription("เรื่อง").setRequired(true).setMaxLength(100),
    )
    .addStringOption((o) =>
      o.setName("detail").setDescription("รายละเอียด").setRequired(true).setMaxLength(1000),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const topic = interaction.options.getString("topic", true).trim();
    const detail = interaction.options.getString("detail", true).trim();
    const { created } = openTicket(interaction.user.id, topic, detail);

    // ephemeral — เรื่องที่ส่งถึงแอดมินอาจเป็นเรื่องส่วนตัว ไม่ควรโผล่ให้ทั้งห้องเห็น
    await interaction.reply({
      content: created
        ? `📨 ส่ง ticket เรื่อง **${topic}** ถึงแอดมินแล้ว — ปิดเรื่องเมื่อไหร่จะแจ้งทาง DM`
        : "คุณมี ticket ค้างอยู่ รอแอดมินปิดเรื่องเดิมก่อนแล้วค่อยเปิดใหม่นะ",
      flags: MessageFlags.Ephemeral,
    });
  },
};
