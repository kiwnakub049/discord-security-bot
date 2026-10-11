import { DiscordAPIError, type Client } from "discord.js";

/**
 * ลบข้อความตามรายการ "channelId/messageId" (เช่น queue_items.refs ของการ์ด AI spam)
 *
 * ข้อความ/ห้องที่หายไปก่อนแล้ว (10008 Unknown Message / 10003 Unknown Channel) นับเป็น gone
 * ไม่ใช่ failed — ผลที่ mod ต้องการ (ข้อความไม่อยู่) เกิดแล้ว ส่วน failed = ลบไม่ได้จริง (มักเป็นสิทธิ์)
 */
export async function deleteMessageRefs(
  client: Client,
  refs: string[],
): Promise<{ deleted: number; gone: number; failed: number }> {
  const out = { deleted: 0, gone: 0, failed: 0 };
  for (const ref of refs) {
    const [channelId, messageId] = ref.split("/");
    if (!channelId || !messageId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        out.gone++;
        continue;
      }
      await channel.messages.delete(messageId);
      out.deleted++;
    } catch (err) {
      if (err instanceof DiscordAPIError && (err.code === 10008 || err.code === 10003)) out.gone++;
      else out.failed++;
    }
  }
  return out;
}
