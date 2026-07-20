import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error("❌ ต้องตั้ง DISCORD_TOKEN และ CLIENT_ID ใน .env ก่อน");
  process.exit(1);
}

const body = [...commands.values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(token);

try {
  if (guildId) {
    // deploy ลงเซิร์ฟเวอร์เดียว — ขึ้นทันที เหมาะกับตอนทดสอบ
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`✅ ลงทะเบียน ${body.length} คำสั่งในเซิร์ฟเวอร์ ${guildId} แล้ว`);
  } else {
    // deploy แบบ global — ใช้ได้ทุกเซิร์ฟเวอร์ แต่ใช้เวลา ~1 ชม. กว่าจะอัปเดต
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log(`✅ ลงทะเบียน ${body.length} คำสั่งแบบ global แล้ว`);
  }
} catch (err) {
  console.error("ลงทะเบียนคำสั่งไม่สำเร็จ:", err);
  process.exit(1);
}
