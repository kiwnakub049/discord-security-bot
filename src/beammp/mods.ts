import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { paths } from "./paths.js";
import { isValidLevelFolder } from "./fields.js";

const execFileAsync = promisify(execFile);

/**
 * ม็อดฝั่งผู้เล่น — ไฟล์ zip ใน Resources/Client ที่เซิร์ฟส่งให้ทุกคนตอนเข้าเกม
 *
 * ── จุดที่ต้องระวัง ──
 * ชื่อไฟล์มาจากเบราว์เซอร์ ถ้าเอามาต่อ path ตรง ๆ คนส่ง "../../.ssh/authorized_keys"
 * ก็เขียนไฟล์นอกโฟลเดอร์ได้ ทุกชื่อจึงถูกบีบให้เหลือแค่ basename และต้องลงท้าย .zip
 */

/** เพดานขนาดไฟล์ — ม็อดแผนที่ใหญ่ ๆ แตะ 1GB ได้จริง */
export const MAX_MOD_BYTES = 1024 * 1024 * 1024;

export interface ModFile {
  name: string;
  size: number;
  at: number;
  /** แผนที่ที่อยู่ในม็อดนี้ (path แบบที่ใส่ใน ServerConfig ได้เลย) */
  levels?: string[];
}

/**
 * ทำให้ชื่อไฟล์ปลอดภัย
 * @returns ชื่อที่ใช้ได้ หรือ null ถ้ารับไม่ได้
 */
export function safeModName(raw: string): string | null {
  // basename ตัด path ทั้งหมดทิ้ง — "../../x.zip" เหลือ "x.zip"
  const name = basename(raw).trim();
  if (name.length === 0 || name.length > 120) return null;
  if (name.startsWith(".")) return null; // กันไฟล์ซ่อน และกัน ".." ที่เหลือรอด
  if (extname(name).toLowerCase() !== ".zip") return null;
  /*
   * อนุญาตอักษร/เลข/ช่องว่าง/ - _ . ( ) เท่านั้น
   *
   * \p{M} = สระและวรรณยุกต์ ต้องมีด้วย ไม่งั้นชื่อไทยส่วนใหญ่จะถูกปฏิเสธ
   * ("ทดสอบมอด" ผ่านเพราะไม่มีวรรณยุกต์ แต่ "แผนที่" ไม่ผ่าน เพราะ ี กับ ่
   *  จัดอยู่ใน Mark ไม่ใช่ Letter — เจอตอนทดสอบอัปโหลดจริง)
   */
  if (!/^[\p{L}\p{M}\p{N} _.()\-]+$/u.test(name)) return null;
  return name;
}

function modsDir(): string {
  if (!existsSync(paths.mods)) mkdirSync(paths.mods, { recursive: true });
  return paths.mods;
}

/** เป็นไฟล์ zip จริงไหม — ดูลายเซ็น "PK" ที่ต้นไฟล์ ไม่เชื่อนามสกุล */
export function looksLikeZip(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(2);
    return readSync(fd, buf, 0, 2, 0) === 2 && buf.toString("latin1") === "PK";
  } finally {
    closeSync(fd);
  }
}

/**
 * หาแผนที่ที่อยู่ในไฟล์ม็อด
 *
 * ใช้ zipinfo อ่านสารบัญของ zip แทนที่จะแตกไฟล์ — ม็อดแผนที่ขนาดหลายร้อย MB
 * ถ้าแตกออกมาทั้งก้อนเพื่อดูว่ามีอะไรข้างใน จะกินดิสก์และเวลาโดยไม่จำเป็น
 *
 * คืน path รูปแบบที่ใส่ใน ServerConfig ได้เลย เช่น "/levels/my_map/info.json"
 */
export async function levelsInMod(zipPath: string): Promise<string[]> {
  try {
    // -1 = เอาแค่ชื่อไฟล์ อย่างละบรรทัด
    const { stdout } = await execFileAsync("zipinfo", ["-1", zipPath], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    });
    const found = new Set<string>();
    for (const line of stdout.split("\n")) {
      // ยอมรับทั้ง "levels/x/info.json" และ "/levels/x/info.json"
      const m = /(?:^|\/)levels\/([^/]+)\/info\.json$/.exec(line.trim());
      // ใช้กฎเดียวกับตอนตรวจค่า ไม่งั้นจะสแกนเจอแผนที่ที่ตั้งค่าไม่ได้ (หรือกลับกัน)
      if (m && isValidLevelFolder(m[1]!)) found.add(`/levels/${m[1]}/info.json`);
    }
    return [...found].sort();
  } catch {
    // zip เสีย หรือ zipinfo ไม่มี — ไม่ใช่เรื่องคอขาดบาดตาย แค่ไม่มีรายการแผนที่ให้เลือก
    return [];
  }
}

export async function listMods(): Promise<ModFile[]> {
  const files = readdirSync(modsDir()).filter(
    (f) => extname(f).toLowerCase() === ".zip",
  );
  const out = await Promise.all(
    files.map(async (name) => {
      const p = join(paths.mods, name);
      const s = statSync(p);
      return { name, size: s.size, at: s.mtimeMs, levels: await levelsInMod(p) };
    }),
  );
  return out.sort((a, b) => b.at - a.at);
}

/**
 * รับไฟล์แบบสตรีม — เขียนลงดิสก์ทีละก้อน ไม่อมทั้งไฟล์ไว้ในหน่วยความจำ
 *
 * ไฟล์ 1GB ถ้าอ่านเข้า Buffer ก่อนจะกิน RAM 1GB ต่อการอัปโหลดหนึ่งครั้ง
 * (และอีก 1GB ฝั่ง dashboard ที่ส่งต่อมา) บนเครื่องที่รันบอท+AI อยู่ด้วยนั้นเสี่ยงเกินไป
 *
 * เขียนลงไฟล์ .part ก่อนแล้วค่อย rename — ถ้าอัปโหลดหลุดกลางคัน จะไม่เหลือ zip
 * ครึ่ง ๆ ที่เซิร์ฟพยายามส่งให้ผู้เล่นแล้วพัง
 */
export function tooBigMessage(): string {
  return `ไฟล์ใหญ่เกิน ${Math.round(MAX_MOD_BYTES / 1024 / 1024 / 1024)} GB`;
}

function safeUnlink(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    // ไม่มีไฟล์อยู่แล้ว
  }
}

export function deleteMod(rawName: string): { ok: boolean; error?: string } {
  const name = safeModName(rawName);
  if (!name) return { ok: false, error: "ชื่อไฟล์ใช้ไม่ได้" };
  const p = join(modsDir(), name);
  if (!existsSync(p)) return { ok: false, error: "ไม่พบไฟล์นี้" };
  unlinkSync(p);
  return { ok: true };
}
