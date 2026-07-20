import { Events, ActivityType, type Client } from "discord.js";
import { logEvent } from "../utils/logger.js";
import { seedVoiceStates } from "../store/voiceState.js";

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client<true>): Promise<void> {
  console.log(`✅ ล็อกอินสำเร็จเป็น ${client.user.tag}`);
  console.log(`   ดูแลอยู่ ${client.guilds.cache.size} เซิร์ฟเวอร์`);

  // เติมสถานะเสียงของคนที่อยู่ในห้องอยู่แล้วตอนบอทออนไลน์
  for (const guild of client.guilds.cache.values()) seedVoiceStates(guild);

  client.user.setActivity("ดูแลความปลอดภัย 🛡️", {
    type: ActivityType.Watching,
  });

  await logEvent(client, "info", "system", "system_online", "บอทออนไลน์", [
    { name: "Bot", value: client.user.tag },
    { name: "เซิร์ฟเวอร์", value: `${client.guilds.cache.size}` },
  ]);
}
