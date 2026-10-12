import "dotenv/config";
import { initLogStore } from "../store/logStore.js";
import { applyOverrides } from "../store/settingsStore.js";
import { startWebServer } from "../web/server.js";
import { DEV_USER } from "./devSession.js";

/**
 * รันเฉพาะ web dashboard โดยไม่ต่อ Discord (npm run web)
 * ไว้พัฒนา/ดูหน้าเว็บบนเครื่อง โดยไม่ต้องมี DISCORD_TOKEN ที่ใช้งานได้
 * ข้อจำกัด: ไม่มี client → ชื่อผู้ใช้แสดงเป็น ID, รูปบัตรโหลดไม่ได้,
 * ปุ่มสั่งการ (ban/kick/lock) ตอบ "ไม่พบเซิร์ฟเวอร์"
 *
 * login: ไม่มีบอทให้ถามยศ เลยให้สิทธิ์ admin กับบัญชีจำลอง "dev" คนเดียว
 * สร้าง cookie ของบัญชีนี้ด้วย  npm run dev:session  (ต้องมีไฟล์ DB + SESSION_SECRET เดียวกัน
 * จึงไม่ใช่ช่องโหว่ — คนที่มีของสองอย่างนี้ก็เป็นเจ้าของเครื่องอยู่แล้ว)
 */
applyOverrides();
await initLogStore();
const server = startWebServer(undefined, {
  access: async (id) => (id === DEV_USER ? { role: "admin", name: "dev" } : null),
});
if (!server) process.exit(1);
