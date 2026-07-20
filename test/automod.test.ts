/**
 * ทดสอบ autoMod + antiSpam + warningStore + pruneLogs ด้วย mock Message
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db
process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botmod-")), "test.db");

const { handleAutoMod } = await import("../src/modules/autoMod.js");
const { handleSpamCheck } = await import("../src/modules/antiSpam.js");
const { addWarning, getWarnings, clearWarnings } = await import(
  "../src/modules/warningStore.js"
);
const { addLog, getLogs, pruneLogs } = await import("../src/store/logStore.js");
const { db } = await import("../src/store/db.js");
const { config } = await import("../src/config.js");

/* ---------- mock Message (เท่าที่โมดูลใช้จริง) ---------- */
type Mock = {
  msg: any;
  deleted: () => boolean;
  timedOut: () => boolean;
};

function mockMessage(opts: {
  content?: string;
  userId?: string;
  mentions?: number;
  bot?: boolean;
}): Mock {
  let deleted = false;
  let timedOut = false;
  const member = {
    id: opts.userId ?? "u1",
    user: { bot: opts.bot ?? false, tag: "user#0" },
    guild: { id: "g1", name: "TestGuild" },
    roles: { cache: [] }, // array มี .some เหมือน Collection
    permissions: { has: () => false },
    moderatable: true,
    timeout: async () => { timedOut = true; },
    send: async () => {}, // DM แจ้งผู้ใช้
  };
  const msg = {
    guild: { id: "g1", name: "TestGuild" },
    member,
    author: { id: opts.userId ?? "u1", bot: opts.bot ?? false, tag: "user#0" },
    content: opts.content ?? "",
    channelId: "c1",
    client: {},
    mentions: { users: { size: opts.mentions ?? 0 }, roles: { size: 0 } },
    deletable: true,
    delete: async () => { deleted = true; },
  };
  return { msg, deleted: () => deleted, timedOut: () => timedOut };
}

/* ---------- auto-mod ---------- */

test("auto-mod: ลบข้อความที่มี invite เซิร์ฟเวอร์อื่น", async () => {
  const m = mockMessage({ content: "เข้ามาเลย discord.gg/abc123" });
  assert.equal(await handleAutoMod(m.msg), true);
  assert.equal(m.deleted(), true);
});

test("auto-mod: จับลิงก์ phishing (dlscord typosquat)", async () => {
  const m = mockMessage({ content: "free nitro! https://dlscord.gift/claim" });
  assert.equal(await handleAutoMod(m.msg), true);
  assert.equal(m.deleted(), true);
});

test("auto-mod: จับคำต้องห้ามแบบไม่สนตัวพิมพ์", async () => {
  config.autoMod.bannedWords = ["ห้ามคำนี้"];
  const m = mockMessage({ content: "นี่ไง ห้ามคำนี้ เลย" });
  assert.equal(await handleAutoMod(m.msg), true);
  config.autoMod.bannedWords = [];
});

test("auto-mod: ข้อความปกติผ่านได้", async () => {
  const m = mockMessage({ content: "สวัสดีครับทุกคน" });
  assert.equal(await handleAutoMod(m.msg), false);
  assert.equal(m.deleted(), false);
});

test("auto-mod: bot ได้รับการยกเว้น (isExempt)", async () => {
  const m = mockMessage({ content: "discord.gg/abc123", bot: true });
  assert.equal(await handleAutoMod(m.msg), false);
});

/* ---------- anti-spam ---------- */

test("anti-spam: mention เกิน maxMentions โดนลงโทษ", async () => {
  const m = mockMessage({ userId: "spam-mention", content: "hi", mentions: config.antiSpam.maxMentions + 1 });
  assert.equal(await handleSpamCheck(m.msg), true);
  assert.equal(m.deleted(), true);
  assert.equal(m.timedOut(), true);
});

test("anti-spam: ส่งถี่เกิน maxMessages ใน window โดนลงโทษ", async () => {
  let punished = false;
  for (let i = 0; i < config.antiSpam.maxMessages + 1; i++) {
    const m = mockMessage({ userId: "spam-fast", content: `msg ${i}` });
    if (await handleSpamCheck(m.msg)) punished = m.timedOut();
  }
  assert.equal(punished, true);
});

test("anti-spam: ข้อความซ้ำเกิน maxDuplicates โดนลงโทษ", async () => {
  let punished = false;
  for (let i = 0; i < config.antiSpam.maxDuplicates + 1; i++) {
    const m = mockMessage({ userId: "spam-dup", content: "ซ้ำ ๆ เดิม ๆ" });
    if (await handleSpamCheck(m.msg)) punished = true;
  }
  assert.equal(punished, true);
});

test("anti-spam: พิมพ์ปกติไม่โดนลงโทษ", async () => {
  const m = mockMessage({ userId: "normal", content: "ข้อความเดียวธรรมดา" });
  assert.equal(await handleSpamCheck(m.msg), false);
});

/* ---------- warning store ---------- */

test("warningStore: เพิ่ม/อ่าน/ล้างเตือน", () => {
  const r1 = addWarning("w1", "พูดหยาบ", "mod1", "mod#1");
  const r2 = addWarning("w1", "สแปม", "mod1", "mod#1");
  assert.equal(r1.count, 1);
  assert.equal(r2.count, 2);
  assert.equal(getWarnings("w1").length, 2);
  assert.equal(clearWarnings("w1"), 2);
  assert.equal(getWarnings("w1").length, 0);
});

/* ---------- log retention ---------- */

test("pruneLogs: ลบเฉพาะ log ที่เก่ากว่า retentionDays", async () => {
  await addLog("info", "system", "t", "log ใหม่");
  // แทรก log เก่า 100 วันตรง ๆ (addLog ใช้เวลาปัจจุบันเสมอ)
  db.prepare(
    "INSERT INTO logs (timestamp, level, category, event, title, fields) VALUES (?, 'info', 'system', 't', 'log เก่า', '[]')",
  ).run(Date.now() - 100 * 24 * 60 * 60 * 1000);

  config.logging.retentionDays = 90;
  assert.equal(pruneLogs(), 1); // ลบเฉพาะตัวเก่า
  assert.ok(getLogs().every((e) => e.title !== "log เก่า"));

  config.logging.retentionDays = 0; // 0 = ปิด ไม่ลบอะไร
  assert.equal(pruneLogs(), 0);
});
