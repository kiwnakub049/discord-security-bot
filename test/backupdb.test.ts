/**
 * ทดสอบสคริปต์สำรองข้อมูล — รันเป็นโปรเซสจริงผ่าน tsx ไม่ใช่ import เข้ามา
 * เพราะตัวสคริปต์เรียก main() ทันทีตอนโหลด และจบด้วย process.exit
 *
 * ชี้ BOT_DB_PATH กับ BOT_BACKUP_DIR ไปที่ tmp ทั้งคู่ ไม่แตะข้อมูลจริง
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;
let dbPath: string;
let backupDir: string;

/** รันสคริปต์สำรองหนึ่งครั้ง คืน stdout */
function runBackup(keep = 14, out?: string): string {
  return execFileSync("npx", ["tsx", "src/scripts/backupDb.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      BOT_DB_PATH: dbPath,
      BOT_BACKUP_DIR: out ?? backupDir,
      BOT_BACKUP_KEEP: String(keep),
    },
  });
}

const gzFiles = (d?: string): string[] =>
  readdirSync(d ?? backupDir).filter((f) => f.endsWith(".db.gz")).sort();

before(() => {
  dir = mkdtempSync(join(tmpdir(), "bkp-"));
  dbPath = join(dir, "bot.db");
  backupDir = join(dir, "out");

  // DB ต้นฉบับที่มีข้อมูลจริงพอให้ตรวจได้ว่าสำรองมาครบ
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE members (id TEXT PRIMARY KEY, note TEXT)");
  const ins = db.prepare("INSERT INTO members VALUES (?, ?)");
  for (let i = 0; i < 25; i++) ins.run(String(i), `สมาชิก ${i}`);
  db.close();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("สำรองแล้วได้ไฟล์ .gz ออกมาหนึ่งชุด", () => {
  const out = runBackup();
  assert.match(out, /✅ สำรองแล้ว/);
  assert.equal(gzFiles().length, 1);
});

test("ไม่ทิ้งไฟล์ขยะ -wal / -shm ไว้ในโฟลเดอร์สำรอง", () => {
  const junk = readdirSync(backupDir).filter(
    (f) => f.endsWith("-wal") || f.endsWith("-shm") || f.endsWith(".db"),
  );
  assert.deepEqual(junk, []);
});

test("แตกไฟล์สำรองกลับมาแล้วเปิดได้ ข้อมูลครบ", () => {
  const gz = join(backupDir, gzFiles()[0] as string);
  const restored = join(dir, "restored.db");
  execSync(`gunzip -c '${gz}' > '${restored}'`);

  const db = new Database(restored, { readonly: true });
  try {
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    const { c } = db.prepare("SELECT count(*) AS c FROM members").get() as {
      c: number;
    };
    assert.equal(c, 25);
  } finally {
    db.close();
  }
});

test("เก็บย้อนหลังตามจำนวนที่ตั้ง ลบตัวเก่าสุดก่อน", () => {
  // โฟลเดอร์แยกของเทสต์นี้ ไม่ให้ไฟล์จากเทสต์ก่อนหน้ามาปนจนนับไม่ตรง
  const out = join(dir, "prune");
  mkdirSync(out, { recursive: true });
  // ของเก่าปลอม 8 ชุด ชื่อขึ้นต้นด้วยปี 2020 เลยเก่ากว่าตัวที่เพิ่งสำรองแน่นอน
  for (let i = 1; i <= 8; i++) {
    const d = String(i).padStart(2, "0");
    writeFileSync(join(out, `bot-2020-01-${d}T0300.db.gz`), "");
  }

  runBackup(3, out);

  const after = gzFiles(out);
  assert.equal(after.length, 3, "ต้องเหลือเท่าที่ตั้งไว้พอดี");
  // 9 ไฟล์ เหลือ 3 = ตัดตัวเก่าสุด 6 ตัวทิ้ง เหลือสองตัวท้ายของปี 2020 กับตัวใหม่
  assert.deepEqual(
    after.slice(0, 2),
    ["bot-2020-01-07T0300.db.gz", "bot-2020-01-08T0300.db.gz"],
    "ต้องเก็บตัวที่ใหม่กว่าไว้ ไม่ใช่ลบมั่ว",
  );
  assert.ok(
    after[2] && !after[2].startsWith("bot-2020-"),
    `ตัวที่เพิ่งสำรองต้องรอด ไม่ใช่โดนลบไปด้วย: ${after.join(", ")}`,
  );
});

test("DB ต้นฉบับหายไป = จบด้วย exit code ไม่ใช่ศูนย์ ไม่เงียบ", () => {
  const missing = join(dir, "ไม่มีไฟล์นี้", "bot.db");
  assert.throws(() =>
    execFileSync("npx", ["tsx", "src/scripts/backupDb.ts"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, BOT_DB_PATH: missing, BOT_BACKUP_DIR: backupDir },
    }),
  );
  assert.ok(!existsSync(missing));
});
