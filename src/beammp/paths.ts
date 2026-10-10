import { join } from "node:path";

/**
 * ที่อยู่ของไฟล์ต่าง ๆ ของเซิร์ฟเวอร์ BeamMP
 *
 * แยกไฟล์ไว้เพราะทั้ง agent และเทสต้องใช้ชุดเดียวกัน และเทสต้องชี้ไปโฟลเดอร์
 * ชั่วคราวได้โดยไม่แตะของจริง (ผ่าน BEAMMP_DIR)
 */
export const SERVER_DIR = process.env.BEAMMP_DIR || "/home/flick/beammp-server";

export const paths = {
  dir: SERVER_DIR,
  binary: join(SERVER_DIR, "BeamMP-Server"),
  config: join(SERVER_DIR, "ServerConfig.toml"),
  /*
   * ปลั๊กอิน Lua เขียนรายชื่อผู้เล่นไว้ที่นี่ — วางไว้ "นอก" Resources/Server โดยตั้งใจ
   * เพราะ PluginMonitor ของ BeamMP เฝ้าโฟลเดอร์นั้นแบบ recursive ถ้าเขียนไฟล์ในนั้น
   * ทุก 2 วินาที มันจะยิง onFileChanged 30 ครั้ง/นาที ท่วม Server.log จนกลบ error จริง
   * (เจอตอนไล่หาสาเหตุที่ผู้เล่นเข้าไม่ได้ — บรรทัดสำคัญจมอยู่ในกองนี้)
   */
  status: join(SERVER_DIR, "undawn-status.json"),
  /** ม็อดฝั่งผู้เล่น — ไฟล์ zip ที่ถูกส่งให้ทุกคนตอนเข้าเซิร์ฟ */
  mods: join(SERVER_DIR, "Resources", "Client"),
  /** จำว่าตอนปิดเครื่องเซิร์ฟกำลังเปิดอยู่ไหม เพื่อเปิดต่อให้เองหลังรีบูต */
  desired: join(SERVER_DIR, ".desired-state"),
};

/** พอร์ตของ agent — คุยกันเฉพาะใน 127.0.0.1 เหมือน toxic-serve */
export const AGENT_PORT = Number(process.env.BEAMMP_AGENT_PORT) || 3101;
export const AGENT_URL = `http://127.0.0.1:${AGENT_PORT}`;
