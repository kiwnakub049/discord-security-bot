/**
 * สำรอง data/bot.db แบบออนไลน์ — รันได้ระหว่างบอททำงานอยู่ ไม่ต้องหยุด service
 *
 * ห้ามใช้ cp เฉย ๆ กับ DB ตัวนี้ เพราะเปิด WAL mode อยู่ ข้อมูลที่เพิ่งเขียนจะ
 * ค้างอยู่ใน bot.db-wal ยังไม่ลงไฟล์หลัก ก็อปแค่ bot.db จะได้ของเก่าหรือของพัง
 * ต้องใช้ backup API ของ SQLite ที่รู้จัก WAL และล็อกให้เองเป็นช่วง ๆ
 *
 * เสร็จแล้วเปิดไฟล์ที่ได้ตรวจซ้ำทุกครั้ง — สำรองที่ไม่เคยกู้ได้ ก็ไม่ต่างจากไม่มี
 */
import Database from "better-sqlite3";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../store/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BACKUP_DIR =
  process.env.BOT_BACKUP_DIR ||
  join(__dirname, "..", "..", "..", "backups", "discord-bot");

/** เก็บย้อนหลังกี่ชุด — เกินกว่านี้ลบตัวเก่าสุดทิ้ง */
const KEEP = Number(process.env.BOT_BACKUP_KEEP || 14);

/** ชื่อไฟล์เรียงตามเวลาได้ด้วยการเรียงตัวอักษร (2026-08-12T1530) */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/** เปิดไฟล์สำรองขึ้นมาตรวจว่าใช้ได้จริง — คืนจำนวนแถวรวมทุกตาราง */
function verify(path: string): number {
  const copy = new Database(path, { readonly: true });
  try {
    const check = copy.pragma("integrity_check", { simple: true });
    if (check !== "ok") throw new Error(`integrity_check ตอบ: ${check}`);
    const tables = copy
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    let rows = 0;
    for (const t of tables) {
      const r = copy
        .prepare(`SELECT count(*) AS c FROM "${t.name}"`)
        .get() as { c: number };
      rows += r.c;
    }
    return rows;
  } finally {
    copy.close();
  }
}

/** ลบตัวเก่าให้เหลือ KEEP ชุด */
function prune(): string[] {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("bot-") && f.endsWith(".db.gz"))
    .sort();
  const drop = files.slice(0, Math.max(0, files.length - KEEP));
  for (const f of drop) rmSync(join(BACKUP_DIR, f), { force: true });
  return drop;
}

async function main(): Promise<void> {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `bot-${stamp(new Date())}.db`;
  const raw = join(BACKUP_DIR, name);
  const gz = `${raw}.gz`;

  await db.backup(raw);
  const rows = verify(raw); // ตรวจก่อนบีบ ถ้าพังจะได้รู้ตั้งแต่ตอนนี้

  await pipeline(createReadStream(raw), createGzip(), createWriteStream(gz));
  // ต้องลบ -wal กับ -shm ด้วย ไม่ใช่แค่ตัว .db
  // การเปิดไฟล์ตอน verify() สร้างสองตัวนี้ขึ้นมา (DB สืบ WAL mode มาจากต้นฉบับ)
  // ถ้าไม่เก็บกวาด โฟลเดอร์สำรองจะมีขยะค้างเพิ่มขึ้นทุกวัน
  for (const suffix of ["", "-wal", "-shm"]) rmSync(raw + suffix, { force: true });

  const dropped = prune();
  const size = statSync(gz).size;
  console.log(
    `✅ สำรองแล้ว ${gz} (${(size / 1024).toFixed(1)} KB, ${rows} แถว)` +
      (dropped.length ? ` — ลบตัวเก่า ${dropped.length} ชุด` : ""),
  );
}

main().catch((err) => {
  console.error("❌ สำรองข้อมูลไม่สำเร็จ:", err);
  process.exit(1);
});
