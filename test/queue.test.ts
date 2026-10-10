/**
 * คิวรอดำเนินการ — store + ลำดับกองบนหน้าแรก
 * ใช้ DB ชั่วคราวใน tmp ไม่แตะ data/bot.db
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(tmpdir(), "bot-test-queue.db");
process.env.BOT_DB_PATH = DB_PATH;

type Store = typeof import("../src/store/queueStore.js");
type Cats = typeof import("../src/modules/queueCategories.js");
let store: Store;
let cats: Cats;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  store = await import("../src/store/queueStore.js");
  cats = await import("../src/modules/queueCategories.js");
});

test("enqueue ไม่สร้างเรื่องซ้ำของคนเดิมในหมวดเดิมที่ยังค้าง", () => {
  const a = store.enqueue({ category: "ban-approval", subjectId: "1", title: "a" });
  const b = store.enqueue({ category: "ban-approval", subjectId: "1", title: "a อีกรอบ" });
  assert.equal(a, b);
  // คนเดิมแต่คนละหมวด = คนละเรื่อง
  const c = store.enqueue({ category: "suspicious-member", subjectId: "1", title: "a" });
  assert.notEqual(a, c);
});

test("openSummary นับเฉพาะเรื่องที่ค้าง และ oldestAt คือเรื่องเก่าสุด", () => {
  store.enqueue({ category: "admin-ticket", title: "t1", at: 1000 });
  store.enqueue({ category: "admin-ticket", title: "t2", at: 500 });
  const t = store.openSummary().find((s) => s.category === "admin-ticket");
  assert.equal(t?.count, 2);
  assert.equal(t?.oldestAt, 500);
  assert.equal(store.listOpen("admin-ticket")[0]?.title, "t2", "เก่าสุดต้องมาก่อน");
});

test("resolve ปิดได้ครั้งเดียว — กดซ้ำ/กดพร้อมกันได้ false", () => {
  const id = store.enqueue({ category: "ban-approval", subjectId: "9", title: "x" });
  assert.equal(store.resolve(id, "approve", "mod1"), true);
  assert.equal(store.resolve(id, "dismiss", "mod2"), false);
  const row = store.getItem(id);
  assert.equal(row?.outcome, "approve");
  assert.equal(row?.resolved_by, "mod1");
  // ปิดแล้ว ส่งเรื่องเดิมเข้าใหม่ได้ (เป็นเรื่องใหม่)
  assert.notEqual(store.enqueue({ category: "ban-approval", subjectId: "9", title: "x" }), id);
});

test("ลำดับกอง: เกินกำหนดก่อน → รุนแรงกว่าก่อน → รอนานกว่าก่อน", () => {
  const now = 10 * 60 * 60_000;
  const ban = { severity: "alert" as const, oldestAt: now - 5 * 60_000, overdueAfterMin: 30 };
  const oldTicket = { severity: "info" as const, oldestAt: now - 3 * 60 * 60_000, overdueAfterMin: 60 };
  const sus = { severity: "warn" as const, oldestAt: now - 10 * 60_000, overdueAfterMin: 60 };
  const sorted = [sus, ban, oldTicket].sort((a, b) => cats.compareStacks(a, b, now));
  assert.deepEqual(sorted, [oldTicket, ban, sus]);
});

test("ทุกหมวดมีปุ่มอย่างน้อยหนึ่งปุ่ม และ key ไม่ซ้ำ", () => {
  const keys = cats.QUEUE_CATEGORIES.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of cats.QUEUE_CATEGORIES) assert.ok(c.outcomes.length > 0, c.key);
});
