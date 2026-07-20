import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";
import {
  voiceLockDB,
  type ConnectSnapshot,
  type ConnectState,
} from "../modules/voiceLockStore.js";
import { logEvent } from "../utils/logger.js";

const CONNECT = PermissionsBitField.Flags.Connect;

/** หาห้องเป้าหมาย: จาก option `channel` หรือห้องที่ผู้สั่งกำลังอยู่ */
function resolveVoiceChannel(
  interaction: ChatInputCommandInteraction,
): VoiceBasedChannel | null {
  const opt = interaction.options.getChannel("channel");
  if (opt) {
    // resolve เป็น channel object เต็ม ๆ จาก cache (option อาจเป็นแค่ raw API channel)
    const ch = interaction.guild?.channels.cache.get(opt.id);
    return ch?.isVoiceBased() ? ch : null;
  }
  const member = interaction.member as GuildMember | null;
  return member?.voice.channel ?? null;
}

/** อ่านสถานะ Connect ปัจจุบันจาก bitfield allow/deny */
function connectStateOf(allow: bigint, deny: bigint): ConnectState {
  if ((allow & CONNECT) !== 0n) return "allow";
  if ((deny & CONNECT) !== 0n) return "deny";
  return "neutral";
}

/** แปลง ConnectState -> ค่าที่ permissionOverwrites.edit เข้าใจ (true=allow, false=deny, null=neutral) */
function connectValue(state: ConnectState): boolean | null {
  return state === "allow" ? true : state === "deny" ? false : null;
}

/* ─── /lockvoice ─── */
export const lockVoice = {
  data: new SlashCommandBuilder()
    .setName("lockvoice")
    .setDescription("ล็อกห้องเสียง ไม่ให้ใครเข้า + เตะทุกคนออก")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("ห้องเสียง (ไม่ระบุ = ห้องที่คุณอยู่)")
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = resolveVoiceChannel(interaction);
      if (!channel) {
        await interaction.editReply(
          "❌ ไม่พบห้องเสียง — ระบุห้อง หรือเข้าห้องเสียงก่อนใช้คำสั่ง",
        );
        return;
      }
      if (voiceLockDB.isLocked(channel.id)) {
        await interaction.editReply(`🔒 ห้อง **${channel.name}** ถูกล็อกอยู่แล้ว`);
        return;
      }

      const everyone = channel.guild.roles.everyone;
      const everyoneOw = channel.permissionOverwrites.cache.get(everyone.id);
      // ช่องนี้เป็นแบบ "ปิด @everyone" อยู่แล้วหรือไม่ (เช่นห้องที่ gate ด้วย role บัตร)
      const everyoneConnectDenied = everyoneOw
        ? (everyoneOw.deny.bitfield & CONNECT) !== 0n
        : false;

      // 1. snapshot สถานะ Connect เดิมของทุก overwrite (delta — เก็บแค่ Connect)
      const snaps: ConnectSnapshot[] = [];
      for (const o of channel.permissionOverwrites.cache.values()) {
        let prev = connectStateOf(o.allow.bitfield, o.deny.bitfield);
        // กัน "snapshot poison": ถ้า role (ไม่ใช่ @everyone) ถูก deny Connect อยู่แล้ว
        // ในขณะที่ @everyone ก็ deny Connect — การ deny ที่ role นั้นซ้ำซ้อน/ไร้ความหมาย
        // แทบจะแน่ว่าเป็นเศษเหลือจากการล็อกครั้งก่อนที่ค้างไว้ ไม่ใช่ค่าเดิมจริง
        // -> ถือว่าเดิมคือ allow (role ที่ใช้เปิดสิทธิ์เข้าห้อง gate)
        if (o.id !== everyone.id && prev === "deny" && everyoneConnectDenied) {
          prev = "allow";
        }
        snaps.push({ id: o.id, type: o.type, prevConnect: prev });
      }
      // ให้แน่ใจว่ามี @everyone อยู่ใน snapshot (ห้องอาจยังไม่มี overwrite ของ @everyone)
      if (!snaps.some((s) => s.id === everyone.id)) {
        snaps.push({
          id: everyone.id,
          type: OverwriteType.Role,
          prevConnect: "neutral",
        });
      }

      // 2. บันทึกลง DB ก่อนแก้ permission (กันแก้ไปแล้วแต่ state หาย)
      voiceLockDB.set({
        channelId: channel.id,
        lockedBy: interaction.user.id,
        lockedAt: Date.now(),
        overwrites: snaps,
      });

      // 3. ตั้ง Connect:false ให้ทุก overwrite ใน snapshot (รวม @everyone)
      for (const s of snaps) {
        await channel.permissionOverwrites.edit(
          s.id,
          { Connect: false },
          { type: s.type, reason: "ล็อกห้องเสียง" },
        );
      }

      // 4. เตะทุกคนออก (รวม admin) — snapshot ก่อน loop เพราะ disconnect แก้ cache ระหว่างวน
      const targets = [...channel.members.values()];
      for (const m of targets) {
        await m.voice.disconnect("ห้องถูกล็อก").catch(() => {}); // กัน error ถ้าคนออกไปก่อน
      }

      await interaction.editReply(
        `🔒 ล็อกห้อง **${channel.name}** แล้ว — เตะออก ${targets.length} คน`,
      );
      await logEvent(interaction.client, "warn", "audit", "voice_lock", "ล็อกห้องเสียง", [
        { name: "ห้อง", value: `${channel.name} (${channel.id})` },
        { name: "โดย", value: interaction.user.tag },
        { name: "เตะออก", value: `${targets.length} คน` },
      ]);
    } catch (err) {
      console.error("lockvoice error:", err);
      await interaction.editReply(
        "❌ ล็อกไม่สำเร็จ — เช็คสิทธิ์บอท: Manage Channels + Move Members",
      );
    }
  },
};

/* ─── /unlockvoice ─── */
export const unlockVoice = {
  data: new SlashCommandBuilder()
    .setName("unlockvoice")
    .setDescription("ปลดล็อกห้องเสียง คืน permission เดิม")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("ห้องเสียง (ไม่ระบุ = ห้องที่คุณอยู่)")
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = resolveVoiceChannel(interaction);
      if (!channel) {
        await interaction.editReply(
          "❌ ไม่พบห้องเสียง — ระบุห้อง หรือเข้าห้องเสียงก่อนใช้คำสั่ง",
        );
        return;
      }
      const lock = voiceLockDB.get(channel.id);
      if (!lock) {
        await interaction.editReply(`ℹ️ ห้อง **${channel.name}** ไม่ได้ถูกล็อกไว้`);
        return;
      }

      // 1. คืนเฉพาะ bit Connect ของแต่ละ overwrite กลับเป็นค่าเดิม (ไม่แตะ permission อื่น)
      for (const s of lock.overwrites) {
        await channel.permissionOverwrites.edit(
          s.id,
          { Connect: connectValue(s.prevConnect) },
          { type: s.type, reason: "ปลดล็อกห้องเสียง" },
        );
      }

      // 2. verify + heal: ดึงสถานะสด ๆ มาเทียบ ถ้ายังไม่ตรงให้ยัดซ้ำอีกรอบ
      await channel.fetch(true).catch(() => {});
      const mismatched: string[] = [];
      for (const s of lock.overwrites) {
        const ow = channel.permissionOverwrites.cache.get(s.id);
        const live = ow
          ? connectStateOf(ow.allow.bitfield, ow.deny.bitfield)
          : "neutral";
        if (live !== s.prevConnect) {
          await channel.permissionOverwrites.edit(
            s.id,
            { Connect: connectValue(s.prevConnect) },
            { type: s.type, reason: "ปลดล็อกห้องเสียง (heal)" },
          );
          mismatched.push(s.id);
        }
      }

      voiceLockDB.delete(channel.id);

      await interaction.editReply(`🔓 ปลดล็อกห้อง **${channel.name}** แล้ว`);
      await logEvent(interaction.client, "info", "audit", "voice_unlock", "ปลดล็อกห้องเสียง", [
        { name: "ห้อง", value: `${channel.name} (${channel.id})` },
        { name: "โดย", value: interaction.user.tag },
        ...(mismatched.length
          ? [{ name: "heal", value: `แก้ซ้ำ ${mismatched.length} overwrite` }]
          : []),
      ]);
    } catch (err) {
      console.error("unlockvoice error:", err);
      await interaction.editReply(
        "❌ ปลดล็อกไม่สำเร็จ — เช็คสิทธิ์บอท: Manage Channels",
      );
    }
  },
};
