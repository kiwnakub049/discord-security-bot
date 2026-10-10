import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { fetchConfig, fetchStatus, type AgentStatus } from "../beammp/client.js";

/**
 * /beamng — โชว์ว่าเซิร์ฟเกมเปิดอยู่ไหมและเข้าเล่นยังไง
 *
 * ── ทำไมโชว์ IP ในดิสคอร์ดได้โดยไม่เสี่ยง ──
 * เซิร์ฟนี้ไม่ได้ forward พอร์ตออกเน็ต (ตรวจจากเครื่องนอกประเทศแล้วเข้าไม่ถึง)
 * ที่อยู่ที่โชว์เป็น IP ในวง LAN กับ Tailscale ซึ่งคนนอกวงเอาไปใช้ไม่ได้อยู่แล้ว
 * ถ้าวันหนึ่งเปลี่ยนไปเปิดพอร์ตจริง ต้องกลับมาคิดเรื่องนี้ใหม่
 */

/** ตัดชื่อยาว ๆ ไม่ให้ล้น embed (Discord จำกัดช่องละ 1024 ตัวอักษร) */
function playerLines(s: AgentStatus): string {
  const list = s.players?.players ?? [];
  if (list.length === 0) return "_ยังไม่มีใครเข้ามา_";
  const lines = list.map(
    (p) => `• ${p.name}${p.guest ? " _(guest)_" : ""} — ${p.cars} คัน`,
  );
  const text = lines.join("\n");
  return text.length <= 1000 ? text : `${text.slice(0, 980)}\n… และอีกหลายคน`;
}

export const beamng = {
  data: new SlashCommandBuilder()
    .setName("beamng")
    .setDescription("ดูสถานะเซิร์ฟเวอร์ BeamNG และวิธีเข้าเล่น"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // ถาม agent อาจใช้เวลาถึง 5 วิ — defer ไว้ก่อนกัน interaction หมดอายุที่ 3 วิ
    await interaction.deferReply();

    const [status, config] = await Promise.all([fetchStatus(), fetchConfig()]);

    if (!status) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x9aa0a6)
            .setTitle("🚗 เซิร์ฟเวอร์ BeamNG")
            .setDescription("ตอนนี้เช็คสถานะไม่ได้ — ตัวคุมเซิร์ฟเวอร์ไม่ตอบ"),
        ],
      });
      return;
    }

    const name = typeof config?.Name === "string" ? config.Name : "BeamNG";
    const running = status.state === "running";

    const embed = new EmbedBuilder()
      .setColor(running ? 0x57f287 : 0x9aa0a6)
      .setTitle(`🚗 ${name}`)
      .setDescription(
        running
          ? "🟢 **เปิดอยู่** — เข้าเล่นได้เลย"
          : "⚫ **ปิดอยู่** — รอเจ้าของเปิดเซิร์ฟ",
      );

    if (running) {
      /*
       * บอกวิธีเข้าให้ครบในที่เดียว — คนที่ไม่เคยเล่น BeamMP จะหา Direct Connect ไม่เจอ
       * ถ้าให้แค่ IP เปล่า ๆ จะมีคำถามตามมาทุกครั้งว่าเอาไปใส่ตรงไหน
       */
      const addrs = status.addresses.map(
        (a) => `**${a.label}**\n\`${a.host}:${status.port}\``,
      );
      embed.addFields({
        name: "เข้าเล่นยังไง",
        value:
          addrs.length > 0
            ? `${addrs.join("\n")}\n\n_ในเกมกด **Multiplayer → Direct Connect** แล้ววาง IP กับพอร์ต_`
            : "ไม่พบที่อยู่เครือข่าย",
      });

      const map = typeof config?.Map === "string" ? config.Map : "";
      const mapName = /\/levels\/([^/]+)\//.exec(map)?.[1] ?? "ไม่ทราบ";
      const max = typeof config?.MaxPlayers === "number" ? config.MaxPlayers : "?";

      embed.addFields(
        { name: "แผนที่", value: `\`${mapName}\``, inline: true },
        {
          name: "ผู้เล่น",
          value: `${status.players?.count ?? 0} / ${max}`,
          inline: true,
        },
        { name: "ใครอยู่บ้าง", value: playerLines(status) },
      );

      if (status.players?.stale) {
        embed.setFooter({ text: "⚠️ รายชื่อผู้เล่นอาจไม่อัปเดต" });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

/** /beamng-ip — เอาแค่ที่อยู่ ไว้ก็อปแปะเร็ว ๆ (ตอบแบบเห็นคนเดียว) */
export const beamngIp = {
  data: new SlashCommandBuilder()
    .setName("beamng-ip")
    .setDescription("ขอที่อยู่เซิร์ฟเวอร์ BeamNG (เห็นคนเดียว)"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const status = await fetchStatus();
    if (!status || status.addresses.length === 0) {
      await interaction.editReply("เช็คที่อยู่ไม่ได้ตอนนี้");
      return;
    }
    await interaction.editReply(
      status.addresses
        .map((a) => `${a.label}: \`${a.host}:${status.port}\``)
        .join("\n"),
    );
  },
};
