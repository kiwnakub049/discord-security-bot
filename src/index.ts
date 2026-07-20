import "dotenv/config";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { initDb } from "./store/db.js";
import { initLogStore } from "./store/logStore.js";
import { applyOverrides } from "./store/settingsStore.js";
import { startWebServer } from "./web/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error(
    "❌ ไม่พบ DISCORD_TOKEN — คัดลอก .env.example เป็น .env แล้วใส่ token ก่อน",
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // จำเป็นสำหรับ anti-raid (ต้องเปิด Server Members Intent ในหน้า dev portal)
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // จำเป็นสำหรับ anti-spam/auto-mod (ต้องเปิด Message Content Intent)
    GatewayIntentBits.GuildVoiceStates, // สำหรับ log เข้า/ออกห้องเสียง (ไม่ใช่ privileged)
    GatewayIntentBits.GuildModeration, // สำหรับ ban events + audit log (ไม่ใช่ privileged)
  ],
  partials: [Partials.GuildMember],
});

// โหลด event handler ทุกไฟล์ใน src/events อัตโนมัติ
type EventModule = {
  name: string;
  once?: boolean;
  execute: (...args: unknown[]) => unknown;
};

async function loadEvents(): Promise<void> {
  const eventsPath = join(__dirname, "events");
  const files = (await readdir(eventsPath)).filter((f) => f.endsWith(".ts"));

  for (const file of files) {
    const mod: EventModule = await import(join(eventsPath, file));
    if (!mod.name || !mod.execute) {
      console.warn(`⚠️  ข้าม ${file}: ไม่มี name หรือ execute`);
      continue;
    }
    if (mod.once) {
      client.once(mod.name, (...args) => mod.execute(...args));
    } else {
      client.on(mod.name, (...args) => mod.execute(...args));
    }
    console.log(`📦 โหลด event: ${mod.name} (${file})`);
  }
}

// กันบอทล่มจาก error ที่ไม่ได้ดัก (log ไว้ แต่ไม่ปิดโปรเซส)
process.on("unhandledRejection", (err) =>
  console.error("Unhandled rejection:", err),
);
process.on("uncaughtException", (err) =>
  console.error("Uncaught exception:", err),
);

// ดัก error จาก gateway/shard ของ Discord (ไม่ให้บอทล่ม)
client.on(Events.Error, (err) => console.error("Discord client error:", err));
client.on(Events.ShardError, (err) => console.error("Shard error:", err));

// ปิดบอทอย่างสวยงามเมื่อโดนสั่งหยุด (เช่น systemd restart)
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`รับสัญญาณ ${sig} — กำลังปิดบอท...`);
    client.destroy();
    process.exit(0);
  });
}

initDb(); // เปิด/สร้างตาราง SQLite ทั้งหมด (ต้องก่อน store อื่น)
applyOverrides(); // โหลดค่า settings ที่ปรับจากเว็บ (ทับ config ก่อนใช้งาน)
await initLogStore(); // เตรียม log store
startWebServer(client); // เปิดเว็บ dashboard (ส่ง client ไว้ดึงข้อมูลสมาชิก/บัตร)
await loadEvents();
await client.login(token);
