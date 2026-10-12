import "dotenv/config";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client, Events, Partials } from "discord.js";
import { initDb } from "./store/db.js";
import { initLogStore } from "./store/logStore.js";
import { pruneTeamChat } from "./store/teamChatStore.js";
import { applyOverrides } from "./store/settingsStore.js";
import { startWebServer } from "./web/server.js";
import { isPermanentLoginError, loginWithRetry } from "./utils/loginRetry.js";
import { intents, warnIfDegraded } from "./intents.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error(
    "❌ ไม่พบ DISCORD_TOKEN — คัดลอก .env.example เป็น .env แล้วใส่ token ก่อน",
  );
  process.exit(1);
}

// รายการ intent กับเรื่องโหมดจำกัดสิทธิ์อยู่ใน src/intents.ts
warnIfDegraded();
const client = new Client({
  intents,
  // Channel/Message = จำเป็นเพื่อรับ event ของ DM ที่ยังไม่อยู่ใน cache (คนตอบกลับบอท)
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message],
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
// แชททีมเก็บ 90 วัน — ล้างตอนเปิดบอทแล้ววันละครั้ง
{
  const prune = () => {
    const r = pruneTeamChat();
    if (r.messages || r.files) console.log(`🧹 แชททีม: ลบข้อความเก่า ${r.messages} · ไฟล์ ${r.files}`);
  };
  prune();
  setInterval(prune, 24 * 60 * 60 * 1000).unref();
}
startWebServer(client); // เปิดเว็บ dashboard (ส่ง client ไว้ดึงข้อมูลสมาชิก/บัตร)
await loadEvents();

// ต้อง try/catch ตรงนี้เอง ห้ามปล่อยให้ตกไปถึง handler uncaughtException ข้างบน
// เพราะมันแค่ log แล้วปล่อยผ่าน ทำให้ได้ process ที่ "รันอยู่แต่ไม่มีบอท"
try {
  await loginWithRetry(() => client.login(token), {
    shouldRetry: (err) => !isPermanentLoginError(err),
    onRetry: (attempt, delayMs, err) =>
      console.warn(
        `⚠️  ล็อกอินไม่สำเร็จ (ครั้งที่ ${attempt}): ${err instanceof Error ? err.message : String(err)} — ลองใหม่ในอีก ${delayMs / 1000} วิ`,
      ),
  });
} catch (err) {
  if (isPermanentLoginError(err)) {
    console.error("❌ โทเคนใช้ไม่ได้ — ต้องแก้ DISCORD_TOKEN ใน .env เอง:", err);
    // 78 = EX_CONFIG จับคู่กับ RestartPreventExitStatus ใน unit
    // ให้ systemd หยุดวนรีสตาร์ท แล้วขึ้นสถานะ failed ให้เห็นชัด ๆ
    process.exit(78);
  }
  console.error("❌ ล็อกอิน Discord ไม่สำเร็จหลังลองครบทุกครั้ง:", err);
  // ปัญหาชั่วคราว (เน็ต/DNS) — จบด้วย exit code ไม่ใช่ศูนย์
  // ให้ Restart=on-failure พามาเริ่มใหม่ทั้งรอบ
  process.exit(1);
}
