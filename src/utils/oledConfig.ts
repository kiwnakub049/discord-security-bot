import { readFileSync, writeFileSync } from "node:fs";

/**
 * ตั้งค่าจอ OLED บนตัวเครื่อง ที่หน้าเว็บแอดมินแก้ได้
 *
 * สคริปต์ stats_beautiful.py (service oled-stats) คอยดู mtime ของไฟล์นี้แล้วอ่านใหม่เอง
 * จึงไม่ต้องรีสตาร์ทอะไรเลยหลังกดบันทึก — หน้าใหม่ขึ้นภายในรอบวาดถัดไป (~2 วิ)
 *
 * ทำไมใช้ไฟล์: บอทเป็น Node ส่วนจอเป็น Python คนละ process กัน จะให้คุยกันตรง ๆ
 * ต้องเปิดพอร์ตหรือทำ IPC ซึ่งเกินจำเป็นสำหรับค่าตัวเดียว
 *
 * หมายเหตุเรื่องสิทธิ์: discord-bot.service ตั้ง ProtectHome=read-only ไว้
 * โฟลเดอร์นี้เลยต้องถูกระบุใน ReadWritePaths ของ unit ด้วย ไม่งั้นเขียนไม่ได้
 */

const CONFIG_PATH =
  process.env.OLED_CONFIG_PATH || "/home/flick/oled-config/oled.json";

/** ต้องเรียงตรงกับ PAGES ใน stats_beautiful.py */
export const OLED_PAGES = ["LOAD", "THERM", "NET"] as const;
export type OledPage = (typeof OLED_PAGES)[number];

/** ชื่อไทยไว้โชว์ในหน้าเว็บ — ฝั่ง Python ไม่ได้ใช้ ไฟล์เลยเก็บแต่โค้ดสั้น */
export const OLED_PAGE_LABELS: Record<OledPage, string> = {
  LOAD: "โหลด — CPU / RAM",
  THERM: "ความร้อน — อุณหภูมิ / พัดลม / ไฟ",
  NET: "เครือข่าย — IP / ปริมาณข้อมูล",
};

const PAGE_DEFAULT: OledPage = "LOAD"; // ต้องตรงกับ DEFAULT_PAGE ใน stats_beautiful.py

export interface OledConfig {
  page: OledPage;
}

export function isOledPage(v: unknown): v is OledPage {
  return OLED_PAGES.includes(String(v).toUpperCase() as OledPage);
}

/** อ่านค่าปัจจุบัน — ไฟล์หาย/พัง ให้ตอบค่าเริ่มต้นไป ดีกว่าทำหน้าตั้งค่าล่มทั้งหน้า */
export function getOledConfig(): OledConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
      page?: unknown;
    };
    if (isOledPage(raw.page)) {
      return { page: String(raw.page).toUpperCase() as OledPage };
    }
  } catch {
    // ยังไม่เคยตั้งค่า หรือไฟล์เสีย
  }
  return { page: PAGE_DEFAULT };
}

/**
 * เขียนค่าใหม่ — โยน error ต่อถ้าเขียนไม่ได้ ให้ route เป็นคนตอบ 500
 *
 * เขียนทุกครั้งแม้เลือกหน้าเดิม เพราะ mtime ที่ขยับคือสัญญาณเดียวที่ฝั่ง Python ดู
 * ถ้าข้ามการเขียนตอนค่าซ้ำ จอที่ถูกกดปุ่มไปหน้าอื่นแล้วจะดึงกลับไม่ได้
 */
export function setOledConfig(page: string): OledConfig {
  const upper = String(page).toUpperCase() as OledPage;
  if (!isOledPage(upper)) throw new Error(`หน้าจอไม่ถูกต้อง: ${page}`);
  writeFileSync(CONFIG_PATH, `${JSON.stringify({ page: upper }, null, 2)}\n`);
  return { page: upper };
}
