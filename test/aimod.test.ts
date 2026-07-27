/**
 * ทดสอบ aiMod ด้วย mock fetch — ไม่ต้องมี toxic-serve จริง
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db
process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botai-")), "test.db");

const { handleAiMod } = await import("../src/modules/aiMod.js");
const { getWarnings } = await import("../src/modules/warningStore.js");
const { config } = await import("../src/config.js");

/* ---------- mock Message (เท่าที่ aiMod ใช้จริง) ---------- */

function mockMessage(opts: { content?: string; userId?: string; bot?: boolean } = {}) {
  let deleted = false;
  let timedOut = false;
  const member = {
    id: opts.userId ?? "ai-u1",
    user: { bot: opts.bot ?? false, tag: "user#0" },
    guild: { id: "g1", name: "TestGuild" },
    roles: { cache: [] },
    permissions: { has: () => false },
    moderatable: true,
    timeout: async () => { timedOut = true; },
    send: async () => {},
  };
  const msg = {
    guild: { id: "g1", name: "TestGuild" },
    member,
    author: { id: opts.userId ?? "ai-u1", bot: opts.bot ?? false, tag: "user#0" },
    content: opts.content ?? "",
    channelId: "c1",
    client: {},
    deletable: true,
    delete: async () => { deleted = true; },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { msg: msg as any, deleted: () => deleted, timedOut: () => timedOut };
}

/** mock fetch ให้ตอบ zone/score ที่กำหนด — คืน list ของ body ที่ถูกยิงไว้ตรวจ */
function mockClassify(zone: string, score: number) {
  const bodies: { texts: string[] }[] = [];
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        results: [{ score, zone, label: zone === "ignore" ? "ok" : "toxic" }],
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return bodies;
}

/* ---------- โซนทั้งสาม ---------- */

test("ai-mod: โซน auto → ลบข้อความ + เข้าระบบเตือน", async () => {
  mockClassify("auto", 0.99);
  const m = mockMessage({ content: "ข้อความ toxic จัด ๆ", userId: "ai-auto" });
  assert.equal(await handleAiMod(m.msg), true);
  assert.equal(m.deleted(), true);
  assert.equal(getWarnings("ai-auto").length, 1);
});

test("ai-mod: โซน review → ไม่แตะข้อความ ไม่เตือน (แค่ log ขึ้น dashboard)", async () => {
  mockClassify("review", 0.6);
  const m = mockMessage({ content: "ข้อความก้ำกึ่ง", userId: "ai-review" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(m.deleted(), false);
  assert.equal(getWarnings("ai-review").length, 0);
});

test("ai-mod: โซน ignore → ผ่านเฉย ๆ", async () => {
  mockClassify("ignore", 0.01);
  const m = mockMessage({ content: "สวัสดีครับทุกคน" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(m.deleted(), false);
});

/* ---------- พฤติกรรมสำคัญ ---------- */

test("ai-mod: ส่งทีละข้อความเสมอ (dynamic int8 คะแนนเปลี่ยนตาม batch)", async () => {
  const bodies = mockClassify("ignore", 0.01);
  await handleAiMod(mockMessage({ content: "ทดสอบ 1" }).msg);
  await handleAiMod(mockMessage({ content: "ทดสอบ 2" }).msg);
  assert.equal(bodies.length, 2);
  for (const b of bodies) assert.equal(b.texts.length, 1);
});

test("ai-mod: service ล่ม → fail-open ปล่อยข้อความผ่าน ไม่ throw", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as any;
  const m = mockMessage({ content: "ข้อความตอน service ตาย" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(m.deleted(), false);
});

test("ai-mod: service ตอบ HTTP error → fail-open เช่นกัน", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async () => ({ ok: false, status: 500 })) as any;
  const m = mockMessage({ content: "ข้อความตอน service พัง" });
  assert.equal(await handleAiMod(m.msg), false);
});

test("ai-mod: bot/exempt ไม่ถูกส่งตรวจเลย", async () => {
  const bodies = mockClassify("auto", 0.99);
  const m = mockMessage({ content: "ข้อความจากบอท", bot: true });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(bodies.length, 0);
});

test("ai-mod: ข้อความสั้นกว่า minLength ไม่ส่งตรวจ", async () => {
  const bodies = mockClassify("auto", 0.99);
  const m = mockMessage({ content: "ก" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(bodies.length, 0);
});

test("ai-mod: ปิดระบบ (enabled=false) → ไม่ทำอะไร", async () => {
  const bodies = mockClassify("auto", 0.99);
  config.aiMod.enabled = false;
  const m = mockMessage({ content: "ข้อความ toxic จัด ๆ" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(bodies.length, 0);
  config.aiMod.enabled = true;
});
