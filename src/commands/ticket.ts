import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { canOpenTicket, confirmTicketOpened, openTicket } from "../modules/ticket.js";

/* ─── /ticket — ตำรวจส่งเรื่องถึงแอดมิน (ไปขึ้นคิวบน dashboard แล้วคุยกันต่อทาง DM) ─── */
export const ticket = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("ส่งเรื่องถึงแอดมิน (เฉพาะตำรวจ · มี ticket ค้างได้คนละ 1 เรื่อง)")
    .addStringOption((o) =>
      o.setName("topic").setDescription("เรื่อง").setRequired(true).setMaxLength(100),
    )
    .addStringOption((o) =>
      o.setName("detail").setDescription("รายละเอียด").setRequired(true).setMaxLength(1000),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // ephemeral ทุกคำตอบ — เรื่องที่ส่งถึงแอดมินอาจเป็นเรื่องส่วนตัว ไม่ควรโผล่ให้ทั้งห้องเห็น
    const reply = (content: string) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral });

    const allowed = canOpenTicket(interaction.member as GuildMember | null);
    if (allowed === "no-role") {
      await reply("ระบบ ticket ยังไม่เปิดใช้ — แอดมินยังไม่ได้ตั้งยศตำรวจ");
      return;
    }
    if (allowed === "not-police") {
      await reply("ticket ใช้ได้เฉพาะตำรวจ");
      return;
    }

    const topic = interaction.options.getString("topic", true).trim();
    const detail = interaction.options.getString("detail", true).trim();
    const { created } = openTicket(interaction.user.id, topic, detail, interaction.user.tag);
    if (!created) {
      await reply("คุณมี ticket ค้างอยู่ — มีอะไรเพิ่มเติมพิมพ์ตอบใน DM ของบอทได้เลย หรือรอแอดมินปิดเรื่องเดิมก่อน");
      return;
    }

    const dmOk = await confirmTicketOpened(interaction.user, topic);
    await reply(
      dmOk
        ? `📨 ส่ง ticket เรื่อง **${topic}** ถึงแอดมินแล้ว — แอดมินจะตอบทาง DM ของบอท`
        : `📨 ส่ง ticket เรื่อง **${topic}** แล้ว แต่บอท DM หาคุณไม่ได้\n` +
            "เปิด \"อนุญาตข้อความส่วนตัวจากสมาชิกในเซิร์ฟเวอร์\" ก่อน ไม่งั้นแอดมินตอบกลับไม่ได้",
    );
  },
};
