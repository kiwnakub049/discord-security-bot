import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, initDb } from "../store/db.js";

/**
 * npm run db:migrate
 *
 * ย้ายข้อมูลเดิมจาก data/*.json + data/logs.jsonl เข้า SQLite (data/bot.db)
 * - idempotent: รันซ้ำได้ ไม่เพิ่มข้อมูลซ้ำ (เช็คก่อนว่าตารางว่างหรือยัง)
 * - ไม่ลบไฟล์เดิม แต่ rename เป็น *.migrated เมื่อย้ายสำเร็จ (กันรันซ้ำ + เก็บ backup)
 *
 * ขั้นตอนบน VPS:  หยุดบอท → git pull → npm install → npm run db:migrate → start
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");

function readJson<T>(name: string): T | null {
  const file = join(dataDir, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    console.error(`⚠️  อ่าน ${name} ไม่ได้ (ไฟล์เสีย?) — ข้าม`);
    return null;
  }
}

function archive(name: string): void {
  const file = join(dataDir, name);
  if (existsSync(file)) renameSync(file, `${file}.migrated`);
}

function tableCount(table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

initDb();
let total = 0;

/* ---------- users ---------- */
const users = readJson<{ username: string; salt: string; hash: string }[]>(
  "users.json",
);
if (users?.length) {
  if (tableCount("users") > 0) {
    console.log("• users: ตารางมีข้อมูลแล้ว — ข้าม (กันซ้ำ)");
  } else {
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO users (username, salt, hash) VALUES (?, ?, ?)",
    );
    const tx = db.transaction(() => {
      for (const u of users) stmt.run(u.username, u.salt, u.hash);
    });
    tx();
    console.log(`✓ users: ย้าย ${users.length} บัญชี`);
    total += users.length;
  }
  archive("users.json");
}

/* ---------- members ---------- */
const memberStore = readJson<{
  next_id: number;
  members: Record<
    string,
    { member_number: number; join_date: string; bias?: string; status?: string }
  >;
}>("members.json");
if (memberStore?.members && Object.keys(memberStore.members).length) {
  if (tableCount("members") > 0) {
    console.log("• members: ตารางมีข้อมูลแล้ว — ข้าม (กันซ้ำ)");
  } else {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO members (user_id, member_number, join_date, bias, status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const entries = Object.entries(memberStore.members);
    const tx = db.transaction(() => {
      for (const [id, m] of entries) {
        stmt.run(
          id,
          m.member_number,
          m.join_date,
          m.bias ?? "-",
          m.status ?? "-",
        );
      }
    });
    tx();
    console.log(`✓ members: ย้าย ${entries.length} สมาชิก`);
    total += entries.length;
  }
  archive("members.json");
}

/* ---------- warnings ---------- */
const warnStore = readJson<{
  nextId: number;
  warnings: Record<
    string,
    {
      id: number;
      reason: string;
      moderatorId: string;
      moderatorTag: string;
      timestamp: number;
    }[]
  >;
}>("warnings.json");
if (warnStore?.warnings && Object.keys(warnStore.warnings).length) {
  if (tableCount("warnings") > 0) {
    console.log("• warnings: ตารางมีข้อมูลแล้ว — ข้าม (กันซ้ำ)");
  } else {
    const stmt = db.prepare(
      `INSERT INTO warnings (user_id, reason, moderator_id, moderator_tag, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let n = 0;
    const tx = db.transaction(() => {
      for (const [userId, list] of Object.entries(warnStore.warnings)) {
        for (const w of list) {
          stmt.run(userId, w.reason, w.moderatorId, w.moderatorTag, w.timestamp);
          n++;
        }
      }
    });
    tx();
    console.log(`✓ warnings: ย้าย ${n} รายการ`);
    total += n;
  }
  archive("warnings.json");
}

/* ---------- voice locks ---------- */
const locks = readJson<
  Record<
    string,
    { channelId: string; lockedBy: string; lockedAt: number; overwrites: unknown }
  >
>("voicelocks.json");
if (locks && Object.keys(locks).length) {
  if (tableCount("voice_locks") > 0) {
    console.log("• voice_locks: ตารางมีข้อมูลแล้ว — ข้าม (กันซ้ำ)");
  } else {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO voice_locks (channel_id, locked_by, locked_at, overwrites)
       VALUES (?, ?, ?, ?)`,
    );
    const vals = Object.values(locks);
    const tx = db.transaction(() => {
      for (const l of vals) {
        stmt.run(
          l.channelId,
          l.lockedBy,
          l.lockedAt,
          JSON.stringify(l.overwrites ?? []),
        );
      }
    });
    tx();
    console.log(`✓ voice_locks: ย้าย ${vals.length} ห้อง`);
    total += vals.length;
  }
  archive("voicelocks.json");
}

/* ---------- settings ---------- */
const settings = readJson<Record<string, unknown>>("settings.json");
if (settings && Object.keys(settings).length) {
  if (tableCount("settings") > 0) {
    console.log("• settings: ตารางมีข้อมูลแล้ว — ข้าม (กันซ้ำ)");
  } else {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    const entries = Object.entries(settings);
    const tx = db.transaction(() => {
      for (const [k, v] of entries) stmt.run(k, JSON.stringify(v));
    });
    tx();
    console.log(`✓ settings: ย้าย ${entries.length} ค่า`);
    total += entries.length;
  }
  archive("settings.json");
}

/* ---------- logs (logs.jsonl) ---------- */
const logFile = join(dataDir, "logs.jsonl");
if (existsSync(logFile)) {
  if (tableCount("logs") > 0) {
    console.log("• logs: ตารางมีข้อมูลแล้ว — ข้าม (กันซ้ำ)");
  } else {
    const lines = readFileSync(logFile, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const stmt = db.prepare(
      `INSERT INTO logs (timestamp, level, category, event, title, description, fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    let n = 0;
    const tx = db.transaction(() => {
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as {
            timestamp: number;
            level: string;
            category?: string;
            event?: string;
            title: string;
            description?: string;
            fields?: { name: string; value: string }[];
          };
          stmt.run(
            e.timestamp,
            e.level,
            e.category ?? "system",
            e.event ?? "",
            e.title,
            e.description ?? null,
            JSON.stringify(e.fields ?? []),
          );
          n++;
        } catch {
          /* บรรทัดเสีย — ข้าม */
        }
      }
    });
    tx();
    console.log(`✓ logs: ย้าย ${n} รายการ`);
    total += n;
  }
  archive("logs.jsonl");
}

console.log(`\n✅ migration เสร็จ — ย้ายทั้งหมด ${total} รายการ`);
console.log("   ไฟล์เดิมถูก rename เป็น *.migrated (เก็บเป็น backup)");
db.close();
process.exit(0);
