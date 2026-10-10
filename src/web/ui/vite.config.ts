import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * หน้าเว็บถูก build ลง src/web/ui/dist แล้ว Express เสิร์ฟจากที่นั่น
 * (ไม่ build ลง public/ เพราะ public/ เป็นของที่เข้าถึงได้ "ก่อน" login เท่านั้น
 *  ส่วนตัว dashboard ต้องอยู่หลังด่านตรวจ)
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true, // ล้างไฟล์ hash เก่าทิ้ง ไม่ให้ dist โตขึ้นทุกครั้งที่ build
    // Pi build เองในเครื่อง — sourcemap ทำให้ dist ใหญ่ขึ้นหลายเท่าโดยไม่ได้ใช้
    sourcemap: false,
    // ห้ามฝังฟอนต์เป็น data: URI — CSP ตั้ง font-src 'self' ไว้ ไฟล์ subset เล็ก ๆ
    // (ต่ำกว่า 4 KB) ที่ Vite ฝังให้อัตโนมัติจะโดนบล็อก แล้วตัวอักษรบางชุดหายเงียบ ๆ
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  server: {
    // ตอน dev: vite เสิร์ฟหน้าเว็บ แล้วส่งต่อ API ไปให้บอทตัวจริงที่พอร์ต 3000
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/login": "http://127.0.0.1:3000",
      "/logout": "http://127.0.0.1:3000",
      "/icon.svg": "http://127.0.0.1:3000",
    },
  },
});
