import { db } from "../store/db.js";

/**
 * ทะเบียนแผงบัตรที่ปักไว้ในห้อง (จาก /setup-idcard) — ตาราง idcard_panels
 *
 * ต้องจำไว้เพราะสีขอบ embed ของ Discord แก้หลังส่งไม่ได้ การจะให้สี "ไล่ไปเรื่อย ๆ"
 * ต้องให้บอท edit ข้อความแผงเดิมเป็นระยะ ลูปไล่สี (ดู idcard/panelColor.ts) เลยต้อง
 * รู้ว่าแผงอยู่ห้องไหน ข้อความไหน แม้หลังบอท restart
 */

export interface PanelRef {
  guildId: string;
  channelId: string;
  messageId: string;
}

type PanelRow = {
  guild_id: string;
  channel_id: string;
  message_id: string;
};

/** บันทึกแผงใหม่ (ปักซ้ำห้องเดิมได้หลายอัน — คนละ message id) */
export function addPanel(ref: PanelRef): void {
  db.prepare(
    `INSERT OR REPLACE INTO idcard_panels (message_id, channel_id, guild_id)
     VALUES (@messageId, @channelId, @guildId)`,
  ).run(ref);
}

export function listPanels(): PanelRef[] {
  const rows = db
    .prepare("SELECT guild_id, channel_id, message_id FROM idcard_panels")
    .all() as PanelRow[];
  return rows.map((r) => ({
    guildId: r.guild_id,
    channelId: r.channel_id,
    messageId: r.message_id,
  }));
}

/** ลบแผงออกจากทะเบียน (แผงถูกลบไปแล้ว / edit ไม่ได้) */
export function removePanel(messageId: string): void {
  db.prepare("DELETE FROM idcard_panels WHERE message_id = ?").run(messageId);
}
