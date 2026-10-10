/**
 * ทดสอบการนับ log ที่หน้า dashboard ใช้ — สรุปยอด, กราฟย้อนหลัง, เลื่อนดูทีละหน้า
 *
 * ต้องตั้ง BOT_DB_PATH ก่อน import logStore เพราะ db.ts อ่าน env ตอนโหลดโมดูล
 * เลยใช้ dynamic import แทน import ปกติที่ถูกยกขึ้นไปบนสุดเสมอ
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "loghist-"));
process.env.BOT_DB_PATH = join(dir, "test.db");

type Store = typeof import("../src/store/logStore.js");
type Db = typeof import("../src/store/db.js");
let store: Store;
let db: Db["db"];

const DAY = 86_400_000;

/** ใส่ log ตรงเวลาที่ต้องการ — addLog() ใช้ Date.now() เสมอ เลยต้อง insert เอง */
function seed(timestamp: number, level: string, category = "system"): void {
  db.prepare(
    `INSERT INTO logs (timestamp, level, category, event, title, description, fields)
     VALUES (?, ?, ?, 'test', 'ทดสอบ', NULL, '[]')`,
  ).run(timestamp, level, category);
}

/** เที่ยงวันของ "วันนี้ - n" ตามเวลาท้องถิ่น — กลางวันเพื่อไม่ให้ตกขอบ bucket */
function noonDaysAgo(n: number): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).getTime();
}

before(async () => {
  store = await import("../src/store/logStore.js");
  db = (await import("../src/store/db.js")).db;
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("logTotals นับทั้งตาราง ไม่ใช่แค่ 500 แถวล่าสุด", () => {
  db.prepare("DELETE FROM logs").run();
  // 600 > maxEntries (500) — ของเดิมดึง getLogs() มานับ ตัวเลขเลยค้างที่ 500 ตลอด
  for (let i = 0; i < 600; i++) seed(noonDaysAgo(0) + i, i % 3 === 0 ? "alert" : "info");

  const t = store.logTotals();
  assert.equal(t.total, 600);
  assert.equal(t.byLevel.alert, 200);
  assert.equal(t.byLevel.info, 400);
  assert.equal(t.byCategory.system, 600);
});

test("logTotals(since) นับเฉพาะช่วงที่ขอ", () => {
  db.prepare("DELETE FROM logs").run();
  seed(noonDaysAgo(0), "info");
  seed(noonDaysAgo(0), "warn");
  seed(noonDaysAgo(5), "alert"); // เก่ากว่า 24 ชม. ต้องไม่ถูกนับ

  assert.equal(store.logTotals().total, 3);
  assert.equal(store.logTotals(Date.now() - DAY).total, 2);
});

test("logHistory หย่อน log ลงถูกช่องวัน", () => {
  db.prepare("DELETE FROM logs").run();
  seed(noonDaysAgo(0), "info");
  seed(noonDaysAgo(0), "alert");
  seed(noonDaysAgo(2), "warn");
  seed(noonDaysAgo(6), "info");
  seed(noonDaysAgo(30), "alert"); // นอกช่วง 7 วัน ต้องไม่โผล่

  const h = store.logHistory(7);
  assert.equal(h.bucket, "day");
  assert.equal(h.points.length, 7);

  // จุดสุดท้าย = วันนี้ ไล่ถอยหลังไปทางซ้าย
  const today = h.points[6];
  assert.ok(today);
  assert.deepEqual(
    { info: today.info, alert: today.alert, total: today.total },
    { info: 1, alert: 1, total: 2 },
  );
  assert.equal(h.points[4]?.warn, 1, "เมื่อ 2 วันก่อนต้องมี warn 1");
  assert.equal(h.points[0]?.info, 1, "เมื่อ 6 วันก่อนต้องมี info 1");
  assert.equal(
    h.points.reduce((s, p) => s + p.total, 0),
    4,
    "ตัวที่เก่ากว่า 7 วันต้องไม่ถูกนับ",
  );
});

test("logHistory ไม่ทิ้ง log เพราะการหารได้ทศนิยม", () => {
  // เคสจริงที่เคยพัง: SQLite bind epoch ms เป็น REAL แล้วหารได้ 6.72…
  // ทำให้ทุกแถวตกช่องที่ไม่มีอยู่ กราฟขึ้นศูนย์ทั้งแผงทั้งที่ในตารางมีข้อมูล
  db.prepare("DELETE FROM logs").run();
  const n = 40;
  for (let i = 0; i < n; i++) seed(noonDaysAgo(i % 7) + i * 1000, "info");

  const h = store.logHistory(7);
  assert.equal(
    h.points.reduce((s, p) => s + p.total, 0),
    n,
    "ทุกแถวในช่วงต้องถูกนับ ไม่ตกหล่น",
  );
});

test("logHistory ขอ 1-2 วัน แบ่งเป็นรายชั่วโมง", () => {
  db.prepare("DELETE FROM logs").run();
  const h = store.logHistory(1);
  assert.equal(h.bucket, "hour");
  assert.equal(h.points.length, 24);
  assert.equal(h.size, 3_600_000);
});

test("getLogs beforeId เลื่อนหน้าได้ ไม่ซ้ำไม่ข้าม", () => {
  db.prepare("DELETE FROM logs").run();
  for (let i = 0; i < 25; i++) seed(noonDaysAgo(0) + i, "info");

  const page1 = store.getLogs({ limit: 10 });
  const page2 = store.getLogs({ limit: 10, beforeId: page1[9]!.id });
  const page3 = store.getLogs({ limit: 10, beforeId: page2[9]!.id });

  assert.equal(page1.length, 10);
  assert.equal(page2.length, 10);
  assert.equal(page3.length, 5, "หน้าสุดท้ายเหลือ 5");

  const ids = [...page1, ...page2, ...page3].map((e) => e.id);
  assert.equal(new Set(ids).size, 25, "ต้องไม่มี id ซ้ำระหว่างหน้า");
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), "ต้องเรียงใหม่→เก่า");
});
