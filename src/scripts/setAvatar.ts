import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Client, Events, GatewayIntentBits } from "discord.js";

/**
 * npm run avatar:set
 * แปลง icon.svg -> PNG 512x512 แล้วตั้งเป็น avatar ของบอทใน Discord
 * (รันครั้งเดียวพอ — Discord จำกัดจำนวนครั้งเปลี่ยน avatar ต่อช่วงเวลา)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, "..", "web", "public", "icon.svg");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ ไม่พบ DISCORD_TOKEN ใน .env");
  process.exit(1);
}

const png = await sharp(readFileSync(svgPath)).resize(512, 512).png().toBuffer();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  try {
    await c.user.setAvatar(png);
    console.log(`✅ ตั้ง avatar ของ ${c.user.tag} เรียบร้อย`);
  } catch (err) {
    console.error("❌ ตั้ง avatar ไม่สำเร็จ:", err);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

await client.login(token);
