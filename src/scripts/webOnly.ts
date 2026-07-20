import "dotenv/config";
import { initLogStore } from "../store/logStore.js";
import { applyOverrides } from "../store/settingsStore.js";
import { startWebServer } from "../web/server.js";

/**
 * รันเฉพาะ web dashboard โดยไม่ต่อ Discord (npm run web)
 * ไว้พัฒนา/ดูหน้าเว็บบนเครื่อง โดยไม่ต้องมี DISCORD_TOKEN ที่ใช้งานได้
 * ข้อจำกัด: ไม่มี client → ชื่อผู้ใช้แสดงเป็น ID, รูปบัตรโหลดไม่ได้,
 * ปุ่มสั่งการ (ban/kick/lock) ตอบ "ไม่พบเซิร์ฟเวอร์"
 */
applyOverrides();
await initLogStore();
const server = startWebServer();
if (!server) process.exit(1);
