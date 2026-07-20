import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * จุดเชื่อมต่อ SQLite กลางของทั้งบอท (ใช้ better-sqlite3 — API แบบ synchronous
 * ตรงกับ store เดิมที่เป็น sync I/O เลย drop-in ได้โดยไม่ต้องแก้โค้ดที่เรียกใช้)
 *
 * ไฟล์ DB: data/bot.db  (อยู่ใน .gitignore แล้ว เหมือน data/*.json เดิม)
 * เปิด WAL mode = เขียนทนทาน ไม่เสียง่ายตอนไฟดับ + อ่าน/เขียนพร้อมกันได้
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");

// ปกติใช้ data/bot.db — override ด้วย BOT_DB_PATH ได้ (เช่นตอนเทส ให้ชี้ไป DB ชั่วคราว ไม่แตะข้อมูลจริง)
const dbPath = process.env.BOT_DB_PATH || join(dataDir, "bot.db");
if (!process.env.BOT_DB_PATH) mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL"); // ทนไฟดับ + ไม่ล็อกอ่านระหว่างเขียน
db.pragma("foreign_keys = ON");

/** สร้างตารางทั้งหมดถ้ายังไม่มี — เรียกครั้งเดียวตอนบูต (idempotent) */
export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      salt     TEXT NOT NULL,
      hash     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      user_id       TEXT PRIMARY KEY,
      member_number INTEGER NOT NULL UNIQUE,
      join_date     TEXT NOT NULL,
      bias          TEXT NOT NULL DEFAULT '-',
      status        TEXT NOT NULL DEFAULT '-'
    );

    CREATE TABLE IF NOT EXISTS warnings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      reason        TEXT NOT NULL,
      moderator_id  TEXT NOT NULL,
      moderator_tag TEXT NOT NULL,
      timestamp     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);

    CREATE TABLE IF NOT EXISTS voice_locks (
      channel_id TEXT PRIMARY KEY,
      locked_by  TEXT NOT NULL,
      locked_at  INTEGER NOT NULL,
      overwrites TEXT NOT NULL   -- JSON ของ ConnectSnapshot[]
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL        -- JSON ของค่าที่ override
    );

    CREATE TABLE IF NOT EXISTS activity (
      user_id         TEXT PRIMARY KEY,
      messages        INTEGER NOT NULL DEFAULT 0,
      voice_seconds   INTEGER NOT NULL DEFAULT 0,
      xp              INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_activity_xp    ON activity(xp DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_voice ON activity(voice_seconds DESC);

    CREATE TABLE IF NOT EXISTS logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      level       TEXT NOT NULL,
      category    TEXT NOT NULL,
      event       TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      fields      TEXT NOT NULL  -- JSON ของ {name,value}[]
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts    ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_cat   ON logs(category);
  `);
}

// สร้างตารางทันทีตอนโหลดโมดูล — กัน entry point ที่ import store โดยไม่ได้เรียก initDb()
// (เช่น deploy-commands ที่ import commands → logger → logStore ซึ่ง prepare ตอนโหลด)
initDb();
