/**
 * คำตัดสินของ mod ต่อ AI ("ถูก" = toxic / "ผิด" = ok) + หมายเหตุไม่บังคับ
 * DB ชั่วคราวใน tmp
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botverdict-")), "test.db");

type Store = typeof import("../src/store/aiVerdictStore.js");
let store: Store;

before(async () => {
  const { initDb } = await import("../src/store/db.js");
  initDb();
  store = await import("../src/store/aiVerdictStore.js");
});

const row = (log_id: number, verdict: "toxic" | "ok", comment?: string) => ({
  log_id,
  verdict,
  score: 0.7,
  zone: "review",
  text: "ข้อความ",
  user_id: "1",
  decided_by: "mod",
  ...(comment !== undefined ? { comment } : {}),
});

test("หมายเหตุเก็บได้ · แก้ได้ · ว่าง = ไม่มีหมายเหตุ", () => {
  store.setVerdict(row(1, "ok", "พูดเล่นกับเพื่อน"));
  store.setVerdict(row(2, "toxic"));
  assert.deepEqual(store.getVerdictComments(), { 1: "พูดเล่นกับเพื่อน" });

  store.setVerdict(row(1, "toxic", "ด่าจริง"));
  assert.deepEqual(store.getVerdictMap(), { 1: "toxic", 2: "toxic" });
  assert.deepEqual(store.getVerdictComments(), { 1: "ด่าจริง" });

  store.setVerdict(row(1, "toxic", ""));
  assert.deepEqual(store.getVerdictComments(), {});
});

test("export ได้หมายเหตุติดไปด้วย", () => {
  store.setVerdict(row(3, "ok", "ภาษาถิ่น"));
  const r = store.getAllVerdicts().find((v) => v.log_id === 3);
  assert.equal(r?.comment, "ภาษาถิ่น");
});

test("aiDeleted: ปุ่มถูก/ผิดเฉพาะที่บอทลบ (log ใหม่ดูจาก field, log เก่าดูจากหัวข้อ)", async () => {
  const { aiDeleted } = await import("../src/web/routes/ai.js");
  const f = (value: string) => [{ name: "ลบข้อความ", value }];
  assert.equal(aiDeleted({ title: "x", fields: f("ลบแล้ว") }), true);
  assert.equal(aiDeleted({ title: "x", fields: f("ไม่ได้ลบ") }), false);
  assert.equal(aiDeleted({ title: "Claude สงสัยว่าไม่สุภาพ — ลง log ไว้ (ไม่ได้ลบ)", fields: [] }), false);
  assert.equal(aiDeleted({ title: "AI จับ toxic (คะแนนสูง) — ลบข้อความแล้ว (ยังไม่ลงโทษ)", fields: [] }), true);
  assert.equal(aiDeleted({ title: "AI ตรวจพบข้อความ toxic — จัดการอัตโนมัติ", fields: [] }), true);
});
