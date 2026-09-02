import { Events, ActivityType, type Client } from "discord.js";
import { logEvent } from "../utils/logger.js";
import { seedVoiceStates } from "../store/voiceState.js";
import { seedVoiceActivity } from "../modules/voiceActivity.js";
import { checkCardRoleSetup } from "../modules/cardRole.js";
import { startPanelColorCycle } from "../idcard/panelColor.js";
import { seedMuteEnforcement, startMuteExpiryLoop } from "../modules/muteEnforce.js";
import { startSystemStatus } from "../modules/systemStatus.js";

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client<true>): Promise<void> {
  console.log(`✅ ล็อกอินสำเร็จเป็น ${client.user.tag}`);
  console.log(`   ดูแลอยู่ ${client.guilds.cache.size} เซิร์ฟเวอร์`);

  // เติมสถานะเสียงของคนที่อยู่ในห้องอยู่แล้วตอนบอทออนไลน์
  for (const guild of client.guilds.cache.values()) {
    seedVoiceStates(guild);
    seedVoiceActivity(guild); // เริ่มนับเวลาห้องเสียงต่อ (จากตอนนี้)
    await seedMuteEnforcement(guild); // กลับมาบังคับไมค์แดงที่ยังไม่หมดเวลาต่อ
  }

  // ลูปปลดไมค์แดงเมื่อครบกำหนด (Discord ไม่มี timer ในตัว)
  startMuteExpiryLoop(client);

  // ส่งสถานะเครื่องเข้า Discord ผ่าน webhook เป็นระยะ (ถ้าตั้ง STATUS_WEBHOOK_URL)
  startSystemStatus();

  /*
   * เตือนตั้งแต่ตอนบูตถ้าให้ role บัตรไม่ได้
   * ปัญหานี้เกิดจากลำดับ role ในเซิร์ฟเวอร์ ไม่ใช่โค้ด — เปลี่ยนได้ตลอดเวลาโดยที่บอทไม่รู้
   * ถ้าไม่เช็คตรงนี้ จะรู้ตัวก็ต่อเมื่อมีสมาชิกกดสร้างบัตรแล้วไม่ได้ยศ
   */
  for (const guild of client.guilds.cache.values()) {
    const problem = checkCardRoleSetup(guild);
    if (!problem) continue;
    console.warn(`⚠️ role บัตรใน ${guild.name}: ${problem}`);
    await logEvent(client, "warn", "system", "cardrole_setup", "ให้ role บัตรประจำตัวไม่ได้", [
      { name: "เซิร์ฟเวอร์", value: guild.name },
      { name: "สาเหตุ", value: problem },
    ]);
  }

  // เริ่มไล่สีขอบ embed ของแผงบัตรที่ปักไว้ (edit ข้อความเดิมเป็นระยะ)
  startPanelColorCycle(client);

  client.user.setActivity("ดูแลความปลอดภัย 🛡️", {
    type: ActivityType.Watching,
  });

  await logEvent(client, "info", "system", "system_online", "บอทออนไลน์", [
    { name: "Bot", value: client.user.tag },
    { name: "เซิร์ฟเวอร์", value: `${client.guilds.cache.size}` },
  ]);
}
