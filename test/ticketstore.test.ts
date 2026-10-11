/**
 * ticketStore — ข้อความในบทสนทนาของ ticket
 * ใช้ DB ชั่วคราวใน tmp ไม่แตะ data/bot.db
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(tmpdir(), "bot-test-ticketstore.db");
process.env.BOT_DB_PATH = DB_PATH;

type Store = typeof import("../src/store/ticketStore.js");
let store: Store;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  store = await import("../src/store/ticketStore.js");
});

test("listMessages เรียงเก่าสุดก่อน และแยกตามเรื่อง", () => {
  store.addMessage({ queueId: 1, authorKind: "admin", authorName: "flick", body: "สอง", delivered: true, at: 200 });
  store.addMessage({ queueId: 1, authorKind: "police", authorName: "p", body: "หนึ่ง", at: 100 });
  store.addMessage({ queueId: 2, authorKind: "police", authorName: "q", body: "อีกเรื่อง", at: 150 });

  const one = store.listMessages(1);
  assert.deepEqual(one.map((m) => m.body), ["หนึ่ง", "สอง"]);
  assert.equal(one[1]?.delivered, 1);
  assert.equal(one[0]?.delivered, null, "ฝั่งตำรวจไม่มีสถานะส่ง");
  assert.equal(store.listMessages(2).length, 1);
});

test("ไฟล์แนบเก็บเป็นบรรทัด · ไม่มีไฟล์ = null", () => {
  const id = store.addMessage({
    queueId: 3,
    authorKind: "police",
    authorName: "p",
    body: "(ส่งไฟล์แนบ)",
    attachments: ["https://a", "https://b"],
  });
  const m = store.listMessages(3).find((x) => x.id === id);
  assert.equal(m?.attachments, "https://a\nhttps://b");
  store.addMessage({ queueId: 3, authorKind: "police", authorName: "p", body: "x", attachments: [] });
  assert.equal(store.listMessages(3).at(-1)?.attachments, null);
});

test("threadSummary: จำนวน + ใครพูดล่าสุด · เรื่องที่ไม่มีข้อความไม่อยู่ในผล", () => {
  const s = store.threadSummary([1, 2, 99]);
  assert.deepEqual(s.get(1), { count: 2, lastFrom: "admin", lastAt: 200 });
  assert.deepEqual(s.get(2), { count: 1, lastFrom: "police", lastAt: 150 });
  assert.equal(s.has(99), false);
  assert.equal(store.threadSummary([]).size, 0);
});
