import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildChannel,
  type PermissionOverwrites,
} from "discord.js";
import {
  guildLockDB,
  type LockPermSnapshot,
  type PermState,
} from "./guildLockStore.js";

/**
 * ล็อก/ปลดล็อกทั้งเซิร์ฟเวอร์ — จุดเดียวที่ใช้ร่วมกันทั้ง /lock, anti-raid และ dashboard
 * ครอบคลุมทุกประเภทห้อง ไม่ใช่แค่ห้องแชตปกติ:
 *  - Text / Announcement: ปิด SendMessages
 *  - Forum / Media: ปิดสร้างโพสต์ (= สร้าง thread) + ตอบใน thread
 *  - Voice / Stage: ปิดแชตข้อความในห้องเสียง
 * thread ไม่มี permission overwrite ของตัวเอง — คุมผ่านห้องแม่ด้วย SendMessagesInThreads
 *
 * ── ทำไมต้อง snapshot ──
 * ของเดิมตอนปลดล็อกตั้ง permission เป็น `null` (= ลบ override ทิ้ง) ซึ่งพังกับห้องที่
 * "เดิม deny อยู่แล้ว" เช่นห้องประกาศ/กติกาที่ปิดไม่ให้ @everyone พิมพ์ — พอผ่าน
 * รอบ lockdown→unlock ค่า deny เดิมถูกล้างกลายเป็น neutral = ทุกคนพิมพ์ได้
 * ตอนนี้เก็บสถานะเดิมของแต่ละ permission ไว้ก่อนล็อก แล้วคืนค่านั้นตอนปลด
 */
const LOCKABLE = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

/** permission ที่ lockdown แตะ — snapshot/คืนค่าครบทั้งชุดนี้ (key = ชื่อของ discord.js) */
const LOCK_PERMS = [
  "SendMessages",
  "SendMessagesInThreads",
  "CreatePublicThreads",
  "CreatePrivateThreads",
] as const;

const PERM_BITS: Record<(typeof LOCK_PERMS)[number], bigint> = {
  SendMessages: PermissionFlagsBits.SendMessages,
  SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
  CreatePublicThreads: PermissionFlagsBits.CreatePublicThreads,
  CreatePrivateThreads: PermissionFlagsBits.CreatePrivateThreads,
};

/** อ่านสถานะเดิมของ 1 permission จาก overwrite: allow=true, deny=false, ไม่มี=null */
function permStateOf(
  ow: PermissionOverwrites | undefined,
  bit: bigint,
): PermState {
  if (!ow) return null;
  if ((ow.allow.bitfield & bit) !== 0n) return true;
  if ((ow.deny.bitfield & bit) !== 0n) return false;
  return null;
}

/** snapshot สถานะเดิมของทุก permission ที่จะแตะ บน @everyone ของห้องนี้ */
function snapshotPerms(ch: GuildChannel): LockPermSnapshot {
  const ow = ch.permissionOverwrites.cache.get(ch.guild.roles.everyone.id);
  const snap: LockPermSnapshot = {};
  for (const name of LOCK_PERMS) snap[name] = permStateOf(ow, PERM_BITS[name]);
  return snap;
}

/** ค่าที่จะตั้งตอนล็อก: ปิดทุก permission (deny) */
const LOCKED_PERMS: Record<string, false> = Object.fromEntries(
  LOCK_PERMS.map((p) => [p, false]),
);

export async function setGuildLock(
  guild: Guild,
  locked: boolean,
): Promise<{ ok: number; fail: number }> {
  const everyone = guild.roles.everyone;
  let ok = 0;
  let fail = 0;

  for (const ch of guild.channels.cache.values()) {
    if (ch.isThread() || !LOCKABLE.has(ch.type)) continue;
    const channel = ch as GuildChannel;
    try {
      if (locked) {
        // เก็บค่าเดิมก่อน (INSERT OR IGNORE — ล็อกซ้ำไม่ทับ snapshot จริง) แล้วปิดทุก perm
        guildLockDB.set({
          channelId: channel.id,
          guildId: guild.id,
          lockedAt: Date.now(),
          perms: snapshotPerms(channel),
        });
        await channel.permissionOverwrites.edit(everyone, LOCKED_PERMS, {
          reason: "Lockdown เซิร์ฟเวอร์",
        });
      } else {
        // คืนค่าเดิมจาก snapshot ถ้ามี — ไม่มี (ห้องที่ล็อกก่อนมีระบบ snapshot หรือ
        // ห้องที่เพิ่งสร้างระหว่าง lockdown) ใช้ null = ลบ override ตามพฤติกรรมเดิม
        const saved = guildLockDB.get(channel.id);
        const restore: Record<string, PermState> = saved
          ? saved.perms
          : Object.fromEntries(LOCK_PERMS.map((p) => [p, null]));
        await channel.permissionOverwrites.edit(everyone, restore, {
          reason: "ปลดล็อก เซิร์ฟเวอร์",
        });
        guildLockDB.delete(channel.id);
      }
      ok++;
    } catch {
      fail++; // ข้ามห้องที่บอทไม่มีสิทธิ์
    }
  }
  return { ok, fail };
}
