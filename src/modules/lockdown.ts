import { ChannelType, type Guild } from "discord.js";

/**
 * ล็อก/ปลดล็อกทั้งเซิร์ฟเวอร์ — จุดเดียวที่ใช้ร่วมกันทั้ง /lock, anti-raid และ dashboard
 * ครอบคลุมทุกประเภทห้อง ไม่ใช่แค่ห้องแชตปกติ:
 *  - Text / Announcement: ปิด SendMessages
 *  - Forum / Media: ปิดสร้างโพสต์ (= สร้าง thread) + ตอบใน thread
 *  - Voice / Stage: ปิดแชตข้อความในห้องเสียง
 * thread ไม่มี permission overwrite ของตัวเอง — คุมผ่านห้องแม่ด้วย SendMessagesInThreads
 */
const LOCKABLE = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

export async function setGuildLock(
  guild: Guild,
  locked: boolean,
): Promise<{ ok: number; fail: number }> {
  const everyone = guild.roles.everyone;
  const v = locked ? false : null; // null = ลบ override คืนค่าตามสิทธิ์ปกติ
  let ok = 0;
  let fail = 0;
  for (const ch of guild.channels.cache.values()) {
    if (ch.isThread() || !LOCKABLE.has(ch.type)) continue;
    try {
      await ch.permissionOverwrites.edit(everyone, {
        SendMessages: v,
        SendMessagesInThreads: v,
        CreatePublicThreads: v,
        CreatePrivateThreads: v,
      });
      ok++;
    } catch {
      fail++; // ข้ามห้องที่บอทไม่มีสิทธิ์
    }
  }
  return { ok, fail };
}
