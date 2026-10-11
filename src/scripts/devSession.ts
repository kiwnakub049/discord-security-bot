import "dotenv/config";
import { initDb } from "../store/db.js";
import { createSession } from "../auth/session.js";
import { COOKIE_NAME } from "../web/middleware/auth.js";

/** บัญชีจำลองที่ npm run web ยอมให้เข้า (ไม่ใช่ Discord ID จริง — ID จริงเป็นตัวเลขล้วน) */
export const DEV_USER = "dev";

/**
 * npm run dev:session — สร้าง session ของบัญชี dev สำหรับเปิด npm run web บนเครื่อง
 * (ไม่มีบอท = login ด้วย Discord ไม่ได้) แล้วพิมพ์ cookie ออกมาให้ใส่ในเบราว์เซอร์/curl
 * ใช้กับบอทตัวจริงไม่ได้: บอทจริงถามยศจาก Discord และ "dev" ไม่ใช่สมาชิกในเซิร์ฟ
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  initDb();
  const token = createSession(DEV_USER, { userAgent: "dev:session", ip: "127.0.0.1" });
  console.log(`${COOKIE_NAME}=${token}`);
  console.error("ใส่ cookie นี้ใน DevTools (Application → Cookies) แล้วเปิด http://localhost:<WEB_PORT>/");
}
