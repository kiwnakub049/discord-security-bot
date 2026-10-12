/**
 * ปุ่ม "ทดสอบ Claude" ในหน้าตั้งค่า — บอกได้ถูกว่าบอทจะทำอะไร และไม่ทิ้งร่องรอยอะไรไว้
 * ใช้ classifier ปลอม (ไม่ยิง API จริง) · DB ชั่วคราวใน tmp
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botclaudetest-")), "test.db");

const { initDb } = await import("../src/store/db.js");
initDb();
const { testClassify, __setClassifierForTest } = await import("../src/modules/aiMod.js");
const { config } = await import("../src/config.js");
const { getLogs } = await import("../src/store/logStore.js");
const { listOpen } = await import("../src/store/queueStore.js");

after(() => __setClassifierForTest(null));

const fake = (score: number, spamScore = 0, spamType: "scam" | "none" = "none") =>
  __setClassifierForTest(async () => ({
    score,
    zone: score >= config.aiMod.autoScore ? "auto" : score >= config.aiMod.reviewScore ? "review" : "ignore",
    label: score >= 0.5 ? "toxic" : "ok",
    reason: "ทดสอบ",
    spamScore,
    spamType,
  }));

test("คะแนนแต่ละช่วง → บอกการกระทำถูก (ค่าเริ่มต้น: ไม่ลบโซน review)", async () => {
  const cases: [number, string][] = [
    [0.1, "ignore"],
    [0.6, "review"],
    [0.8, "review"],
    [0.95, "auto"],
  ];
  for (const [score, action] of cases) {
    fake(score);
    const r = await testClassify("x");
    assert.ok(r.ok);
    assert.equal(r.action, action, `คะแนน ${score}`);
    assert.equal(r.result?.reason, "ทดสอบ");
  }
});

test("เปิด reviewDeleteScore → โซน review ที่ถึงเกณฑ์บอกว่าจะลบ", async () => {
  const orig = config.aiMod.reviewDeleteScore;
  config.aiMod.reviewDeleteScore = 0.75;
  try {
    fake(0.8);
    const r = await testClassify("x");
    assert.ok(r.ok && r.action === "review-delete");
  } finally {
    config.aiMod.reviewDeleteScore = orig;
  }
});

test("spam สูง → บอกว่าจะขึ้นการ์ด · แต่ถ้าโดนลบเพราะ toxic แล้วไม่ขึ้นซ้ำ", async () => {
  fake(0.1, 0.9, "scam");
  const a = await testClassify("แจก nitro");
  assert.ok(a.ok && a.spamCard);
  fake(0.95, 0.9, "scam");
  const b = await testClassify("แจก nitro");
  assert.ok(b.ok && !b.spamCard);
});

test("Claude ปฏิเสธตัดสิน → result null + ปล่อยผ่าน", async () => {
  __setClassifierForTest(async () => null);
  const r = await testClassify("x");
  assert.ok(r.ok);
  assert.equal(r.result, null);
  assert.equal(r.action, "ignore");
});

test("API พัง → ok:false พร้อมสาเหตุ ไม่โยน error", async () => {
  __setClassifierForTest(async () => {
    throw new Error("boom");
  });
  const r = await testClassify("x");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.error === "boom", "error ทั่วไปต้องบอกข้อความจริง ไม่ใช่แค่คำว่า error");
});

test("ทดสอบแล้วไม่มี log ไม่มีการ์ดในคิว", async () => {
  fake(0.95, 0.9, "scam");
  await testClassify("x");
  assert.equal(getLogs({ events: ["security_ai"] }).length, 0);
  assert.equal(listOpen("ai-spam").length, 0);
});
