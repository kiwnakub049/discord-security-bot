import { Events, type GuildMember } from "discord.js";
import { handleMemberJoin } from "../modules/antiRaid.js";
import { logMemberJoin } from "../modules/serverLog.js";
import { syncCardRole } from "../modules/cardRole.js";

export const name = Events.GuildMemberAdd;

export async function execute(member: GuildMember): Promise<void> {
  await logMemberJoin(member); // log การเข้าเซิร์ฟเวอร์
  await syncCardRole(member); // เพิ่งเข้า = ยังไม่มีบัตร -> เอา role ออกถ้ามีติดมา
  await handleMemberJoin(member); // anti-raid
}
