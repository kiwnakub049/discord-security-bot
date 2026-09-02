import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
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

// จำกัดสิทธิ์ไฟล์ DB เป็นเจ้าของอ่านเท่านั้น — ในไฟล์มี password hash / session hash
// self-heal ทุกครั้งที่บูต เผื่อไฟล์เดิมถูกสร้างด้วย umask หลวม (เดิมได้ 0644 = ใครก็อ่าน)
// -wal/-shm ถูก SQLite สร้างตาม umask เช่นกัน เลย chmod ให้ครบ (best-effort ตอนยังไม่มีไฟล์)
if (!process.env.BOT_DB_PATH) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      chmodSync(dbPath + suffix, 0o600);
    } catch {
      // ไฟล์ยังไม่ถูกสร้าง (เช่น -wal ก่อนเขียนครั้งแรก) — ข้ามไป
    }
  }
}

/** สร้างตารางทั้งหมดถ้ายังไม่มี — เรียกครั้งเดียวตอนบูต (idempotent) */
export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      salt     TEXT NOT NULL,
      hash     TEXT NOT NULL,
      -- 'admin' = จัดการบัญชี + ตั้งค่าบอทได้ | 'mod' = ดู + moderate (ban/kick/warn) เท่านั้น
      role     TEXT NOT NULL DEFAULT 'mod'
    );

    -- session ของ dashboard — เก็บใน DB ไม่ใช่ RAM เพื่อให้รีสตาร์ทบอทแล้วไม่หลุด
    -- (ของเดิมอยู่ใน Map ในหน่วยความจำ ทุกครั้งที่ deploy ทุกคนต้อง login ใหม่)
    --
    -- id เก็บเป็น sha256 ของ token จริง ไม่ใช่ตัว token — ไฟล์ DB ถูกสำรองเป็น .gz
    -- ทุกคืนและก็อปออกนอกเครื่องได้ ถ้าเก็บ token ดิบ ใครได้ไฟล์สำรองไปก็สวมสิทธิ์ได้ทันที
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      expires    INTEGER NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username);
    CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires);

    -- แผงบัตรที่ /setup-idcard ปักไว้ในห้อง — เก็บไว้ให้ลูปไล่สีขอบ embed หาเจอ
    -- หลัง restart (สี embed แก้หลังส่งไม่ได้ ต้อง edit ข้อความเดิมเป็นระยะ)
    CREATE TABLE IF NOT EXISTS idcard_panels (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      guild_id   TEXT NOT NULL
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

    -- key-value เล็ก ๆ ของบอท (เช่น message id ของสถานะเครื่องที่ส่งผ่าน webhook
    -- ไว้ "แก้ข้อความเดิม" ไม่สแปมห้อง — ต้องจำข้าม restart)
    CREATE TABLE IF NOT EXISTS bot_kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );

    -- คนที่โดนลงโทษ "ไมค์แดง" (server mute) จากระบบเตือน — เก็บว่าใครโดนถึงเมื่อไหร่
    -- ต้องเก็บใน DB เพราะ Discord server mute ไม่มี timer ในตัว บอทต้องปลดเอง +
    -- บังคับปิดกลับถ้ามีคนปลดก่อนเวลา (รอด restart ด้วย)
    CREATE TABLE IF NOT EXISTS mute_punishments (
      user_id  TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      until    INTEGER NOT NULL,  -- ปลดเมื่อ epoch ms นี้
      reason   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mute_until ON mute_punishments(until);

    CREATE TABLE IF NOT EXISTS voice_locks (
      channel_id TEXT PRIMARY KEY,
      locked_by  TEXT NOT NULL,
      locked_at  INTEGER NOT NULL,
      overwrites TEXT NOT NULL   -- JSON ของ ConnectSnapshot[]
    );

    -- lockdown ทั้งเซิร์ฟ: เก็บสถานะเดิมของ 4 permission บน @everyone รายห้อง
    -- ก่อนล็อก เพื่อ "คืนค่าเดิม" ตอนปลด แทนที่จะลบ override ทิ้ง (= เผลอเปิด
    -- ห้องที่เดิม deny ไว้ เช่นห้องประกาศ/กติกา ให้ทุกคนพิมพ์ได้)
    CREATE TABLE IF NOT EXISTS guild_locks (
      channel_id TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      locked_at  INTEGER NOT NULL,
      perms      TEXT NOT NULL   -- JSON ของ LockPermSnapshot (perm -> true/false/null)
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

    -- คำตัดสินของ mod ต่อสิ่งที่ AI จับได้ = label สำหรับเทรนโมเดลรอบหน้า
    -- จงใจ "ไม่" ผูก FK กับ logs เพราะ log ถูกลบตาม retentionDays แต่ข้อมูลเทรนต้องอยู่ถาวร
    -- เลยก็อป text/score มาเก็บไว้เองแทนที่จะ join กลับไปดู
    CREATE TABLE IF NOT EXISTS ai_verdicts (
      log_id     INTEGER PRIMARY KEY,   -- 1 การตรวจจับ = 1 คำตัดสิน (กดซ้ำ = เปลี่ยนใจ ทับของเดิม)
      verdict    TEXT NOT NULL,         -- 'toxic' = AI ถูก | 'ok' = AI จับผิดตัว
      score      REAL NOT NULL,
      zone       TEXT NOT NULL,         -- 'review' | 'auto' (ดูจาก level ของ log ตอนบันทึก)
      text       TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      decided_by TEXT NOT NULL,         -- username ของ mod ที่กด
      decided_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_verdicts_at ON ai_verdicts(decided_at);

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

  migrateSchema();
}

/**
 * ปรับ schema ของ DB เดิมให้ทันรุ่นปัจจุบัน (idempotent — รันซ้ำได้ไม่พัง)
 *
 * ตาราง `CREATE TABLE IF NOT EXISTS` ไม่เพิ่มคอลัมน์ให้ตารางที่มีอยู่แล้ว
 * เลยต้อง ALTER เอง โดยเช็คก่อนว่ายังไม่มีคอลัมน์นั้น
 */
function migrateSchema(): void {
  const userCols = db.prepare("PRAGMA table_info(users)").all() as {
    name: string;
  }[];
  if (!userCols.some((c) => c.name === "role")) {
    // DB เดิมมีแต่บัญชีที่ "มีสิทธิ์เต็ม" อยู่แล้ว — ตั้งเป็น admin ทั้งหมด
    // จะได้ไม่ล็อกใครออกจากหน้าจัดการบัญชี/ตั้งค่าตอนอัปเกรด
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  }
}

// สร้างตารางทันทีตอนโหลดโมดูล — กัน entry point ที่ import store โดยไม่ได้เรียก initDb()
// (เช่น deploy-commands ที่ import commands → logger → logStore ซึ่ง prepare ตอนโหลด)
initDb();
