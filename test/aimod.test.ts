/**
 * ทดสอบ aiMod ด้วย classifier ปลอม — ไม่ยิง Claude API จริง
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ปิด console ทั้งไฟล์: บรรทัด log ภาษาไทยยาว ๆ ทำ node test runner deserialize ผลพังเป็นครั้งคราว
// (bug ของ runner ตอนตัดสตรีมกลางตัวอักษรหลายไบต์ ไม่ใช่ของโค้ดเรา)
console.log = () => {};

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db
process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botai-")), "test.db");

const { handleAiMod, __setClassifierForTest, zoneFor } = await import("../src/modules/aiMod.js");
const { getWarnings } = await import("../src/modules/warningStore.js");
const { config } = await import("../src/config.js");
const { getLogs } = await import("../src/store/logStore.js");
const { listOpen } = await import("../src/store/queueStore.js");
const { SPAM_QUEUE_CATEGORY, TOXIC_QUEUE_CATEGORY } = await import("../src/modules/aiMod.js");
const { itemLogIds, itemRefs } = await import("../src/store/queueStore.js");

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

type Spam = { spamType: "scam" | "advert" | "evasion" | "none"; spamScore: number };

/** classifier ปลอมให้ตอบ zone/score ที่กำหนด — คืน list ของข้อความที่ถูกส่งตรวจ */
function mockClassify(zone: "ignore" | "review" | "auto", score: number, reason?: string, spam?: Spam) {
  const texts: string[] = [];
  __setClassifierForTest(async (text) => {
    texts.push(text);
    return { score, zone, label: zone === "ignore" ? "ok" : "toxic", reason, ...spam };
  });
  return texts;
}

/* ---------- โซนทั้งสาม ---------- */

test("ai-mod: โซน auto → ลบข้อความ + เข้าระบบเตือน", async () => {
  mockClassify("auto", 0.99);
  const m = mockMessage({ content: "ข้อความ toxic จัด ๆ", userId: "ai-auto" });
  assert.equal(await handleAiMod(m.msg), true);
  assert.equal(m.deleted(), true);
  assert.equal(getWarnings("ai-auto").length, 1);
});

test("ai-mod: โซน review คะแนนก้ำกึ่ง (< reviewDeleteScore) → ไม่แตะข้อความ ไม่เตือน", async () => {
  mockClassify("review", 0.6);
  const m = mockMessage({ content: "ข้อความก้ำกึ่ง", userId: "ai-review" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(m.deleted(), false);
  assert.equal(getWarnings("ai-review").length, 0);
});

test("ai-mod: เปิด reviewDeleteScore → โซน review คะแนนถึงเกณฑ์ลบข้อความ แต่ไม่เตือน/ลงโทษ", async () => {
  const orig = config.aiMod.reviewDeleteScore;
  config.aiMod.reviewDeleteScore = 0.75;
  try {
    mockClassify("review", 0.7631);
    const m = mockMessage({ content: "ควยยยยยยยย", userId: "ai-revhi" });
    assert.equal(await handleAiMod(m.msg), true, "ต้องถือว่าจัดการแล้ว (ลบ)");
    assert.equal(m.deleted(), true, "ต้องลบข้อความ");
    assert.equal(getWarnings("ai-revhi").length, 0, "แต่ต้องไม่เข้าระบบเตือน");
  } finally {
    config.aiMod.reviewDeleteScore = orig;
  }
});

test("ai-mod: ค่าเริ่มต้นไม่ลบโซน review (ลบแค่ด่าจริงจังโซน auto)", async () => {
  assert.equal(config.aiMod.reviewDeleteScore, 0);
  {
    mockClassify("review", 0.9);
    const m = mockMessage({ content: "คะแนนสูงแต่ปิดการลบ", userId: "ai-revoff" });
    assert.equal(await handleAiMod(m.msg), false);
    assert.equal(m.deleted(), false);
    const log = getLogs({ events: ["security_ai"] }).find((e) =>
      e.fields.some((f) => f.value === "คะแนนสูงแต่ปิดการลบ"),
    );
    assert.equal(log?.fields.find((f) => f.name === "ลบข้อความ")?.value, "ไม่ได้ลบ");
  }
});

test("ai-mod: log ของโซน auto บอกว่าลบแล้ว (หน้าเว็บใช้โชว์ปุ่มถูก/ผิด)", async () => {
  mockClassify("auto", 0.97);
  const m = mockMessage({ content: "ด่าจริงจังมาก", userId: "ai-autolog" });
  await handleAiMod(m.msg);
  const log = getLogs({ events: ["security_ai"] }).find((e) => e.fields.some((f) => f.value === "ด่าจริงจังมาก"));
  assert.equal(log?.fields.find((f) => f.name === "ลบข้อความ")?.value, "ลบแล้ว");
});

test("ai-mod: โซน review → การ์ด 'Claude จับข้อความ' ผูก log + ข้อความ · โซน auto ไม่ขึ้นการ์ด (ลงโทษไปแล้ว)", async () => {
  mockClassify("review", 0.66, "ดูถูกคนอื่น");
  const m = mockMessage({ content: "ข้อความเข้าคิว", userId: "ai-card" });
  m.msg.id = "m77";
  await handleAiMod(m.msg);
  const card = listOpen(TOXIC_QUEUE_CATEGORY).find((x) => x.subject_id === "ai-card");
  assert.ok(card, "ต้องมีการ์ด");
  assert.match(card.detail ?? "", /ข้อความเข้าคิว/);
  assert.match(card.detail ?? "", /Claude: ดูถูกคนอื่น/);
  assert.deepEqual(itemRefs(card), ["c1/m77"]);
  const log = getLogs({ events: ["security_ai"] }).find((e) => e.fields.some((f) => f.value === "ข้อความเข้าคิว"));
  assert.deepEqual(itemLogIds(card), [log!.id]);

  mockClassify("auto", 0.99);
  await handleAiMod(mockMessage({ content: "ด่าแรง", userId: "ai-card-auto" }).msg);
  assert.equal(listOpen(TOXIC_QUEUE_CATEGORY).some((x) => x.subject_id === "ai-card-auto"), false);
});

test("ai-mod: โซน ignore → ผ่านเฉย ๆ", async () => {
  mockClassify("ignore", 0.01);
  const m = mockMessage({ content: "สวัสดีครับทุกคน" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(m.deleted(), false);
});

/* ---------- พฤติกรรมสำคัญ ---------- */

test("ai-mod: คะแนน -> โซน ตาม threshold ใน config", () => {
  const { reviewScore, autoScore } = config.aiMod;
  assert.equal(zoneFor(0), "ignore");
  assert.equal(zoneFor(reviewScore - 0.01), "ignore");
  assert.equal(zoneFor(reviewScore), "review");
  assert.equal(zoneFor(autoScore - 0.01), "review");
  assert.equal(zoneFor(autoScore), "auto");
  assert.equal(zoneFor(1), "auto");
});

test("ai-mod: ส่งทีละข้อความ ครบทั้งข้อความ", async () => {
  const texts = mockClassify("ignore", 0.01);
  await handleAiMod(mockMessage({ content: "ทดสอบ 1" }).msg);
  await handleAiMod(mockMessage({ content: "ทดสอบ 2" }).msg);
  assert.deepEqual(texts, ["ทดสอบ 1", "ทดสอบ 2"]);
});

test("ai-mod: ส่งบริบทของห้องไปด้วย (รวมข้อความทีมงานที่ไม่ได้ส่งตรวจ) + เป้าหมายขึ้น log", async () => {
  const ctxs: unknown[] = [];
  __setClassifierForTest(async (_t, ctx) => {
    ctxs.push(ctx);
    return { score: 0.6, zone: "review", label: "toxic", reason: "แซะ", target: "เอ" };
  });
  const first = mockMessage({ content: "ข้อความแรกในห้องบริบท", userId: "ctx-a" });
  first.msg.channelId = "ctx-room";
  first.msg.id = "ctx1";
  await handleAiMod(first.msg);
  const second = mockMessage({ content: "ข้อความที่สองบริบท", userId: "ctx-b" });
  second.msg.channelId = "ctx-room";
  second.msg.id = "ctx2";
  await handleAiMod(second.msg);
  const ctx = ctxs.at(-1) as { recent: { text: string }[] };
  assert.deepEqual(ctx.recent.map((l) => l.text), ["ข้อความแรกในห้องบริบท"]);
  const log = getLogs({ events: ["security_ai"] }).find((e) => e.fields.some((f) => f.value === "ข้อความที่สองบริบท"));
  assert.equal(log?.fields.find((f) => f.name === "ด่า/แซะใคร")?.value, "เอ");
});

test("ai-mod: API ล่ม → fail-open ปล่อยข้อความผ่าน ไม่ throw", async () => {
  __setClassifierForTest(async () => { throw new Error("ECONNREFUSED"); });
  const m = mockMessage({ content: "ข้อความตอน API ตาย" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(m.deleted(), false);
});

test("ai-mod: ไม่มีคำตัดสิน (โมเดลปฏิเสธ/parse ไม่ได้) → ปล่อยผ่าน", async () => {
  __setClassifierForTest(async () => null);
  const m = mockMessage({ content: "ข้อความที่ไม่มีคำตัดสิน" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(m.deleted(), false);
});

test("ai-mod: ไม่ได้ตั้ง ANTHROPIC_API_KEY → fail-open (classifier จริง)", async () => {
  const orig = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  __setClassifierForTest(null);
  try {
    const m = mockMessage({ content: "ข้อความตอนไม่มี key" });
    assert.equal(await handleAiMod(m.msg), false);
    assert.equal(m.deleted(), false);
  } finally {
    if (orig !== undefined) process.env.ANTHROPIC_API_KEY = orig;
  }
});

test("ai-mod: ข้อความยาวไม่ถูกตัดใน log (ใช้เป็น eval set ได้ครบ)", async () => {
  const { getLogs } = await import("../src/store/logStore.js");
  mockClassify("review", 0.6, "ทดสอบเหตุผล");
  const long = "x".repeat(500);
  await handleAiMod(mockMessage({ content: long, userId: "ai-long" }).msg);
  const entry = getLogs({ events: ["security_ai"] }).find((e) => e.fields.some((f) => f.value === long));
  assert.ok(entry, "ต้องมี log ที่เก็บข้อความครบ 500 ตัว");
  assert.equal(entry.fields.find((f) => f.name === "เหตุผล AI")?.value, "ทดสอบเหตุผล");
});

/* ---------- spam → คิวให้ mod ---------- */

const spamCards = (userId: string) =>
  listOpen(SPAM_QUEUE_CATEGORY).filter((r) => r.subject_id === userId);

test("ai-mod spam: scam คะแนนสูง → เข้าคิว ไม่ลบ ไม่เตือน", async () => {
  mockClassify("ignore", 0.05, "แจก nitro ปลอม", { spamType: "scam", spamScore: 0.95 });
  const m = mockMessage({ content: "แจก nitro ฟรี ทักแชทมา", userId: "spam-1" });
  m.msg.id = "msg-1";
  assert.equal(await handleAiMod(m.msg), false, "ข้อความยังอยู่ ให้ flow ปกติเดินต่อ");
  assert.equal(m.deleted(), false);
  assert.equal(getWarnings("spam-1").length, 0);
  assert.equal(spamCards("spam-1").length, 1);
  const { itemRefs } = await import("../src/store/queueStore.js");
  assert.deepEqual(itemRefs(spamCards("spam-1")[0]!), ["c1/msg-1"], "การ์ดต้องรู้ว่าจะลบข้อความไหน");
});

test("ai-mod spam: คนเดิม spam ซ้ำ → การ์ดใบเดียว", async () => {
  mockClassify("ignore", 0.05, undefined, { spamType: "advert", spamScore: 0.9 });
  await handleAiMod(mockMessage({ content: "รับปั๊มฟอล ถูกมาก", userId: "spam-2" }).msg);
  await handleAiMod(mockMessage({ content: "รับปั๊มฟอล ถูกมาก อีกรอบ", userId: "spam-2" }).msg);
  assert.equal(spamCards("spam-2").length, 1);
});

test("ai-mod spam: none หรือคะแนนต่ำกว่าเกณฑ์ → ไม่เข้าคิว", async () => {
  mockClassify("ignore", 0.05, undefined, { spamType: "none", spamScore: 0.99 });
  await handleAiMod(mockMessage({ content: "ข้อความปกติ", userId: "spam-3" }).msg);
  mockClassify("ignore", 0.05, undefined, { spamType: "scam", spamScore: config.aiMod.spamReviewScore - 0.01 });
  await handleAiMod(mockMessage({ content: "ข้อความก้ำกึ่ง", userId: "spam-3" }).msg);
  assert.equal(spamCards("spam-3").length, 0);
});

test("ai-mod spam: toxic auto + spam พร้อมกัน → ลบตาม toxic ไม่เข้าคิว spam", async () => {
  mockClassify("auto", 0.99, undefined, { spamType: "scam", spamScore: 0.99 });
  const m = mockMessage({ content: "ด่า + scam", userId: "spam-4" });
  assert.equal(await handleAiMod(m.msg), true);
  assert.equal(m.deleted(), true);
  assert.equal(spamCards("spam-4").length, 0);
});

test("ai-mod spam: spamEnabled=false → ไม่เข้าคิว", async () => {
  config.aiMod.spamEnabled = false;
  try {
    mockClassify("ignore", 0.05, undefined, { spamType: "scam", spamScore: 0.99 });
    await handleAiMod(mockMessage({ content: "แจก nitro", userId: "spam-5" }).msg);
    assert.equal(spamCards("spam-5").length, 0);
  } finally {
    config.aiMod.spamEnabled = true;
  }
});

test("ai-mod: bot/exempt ไม่ถูกส่งตรวจเลย", async () => {
  const texts = mockClassify("auto", 0.99);
  const m = mockMessage({ content: "ข้อความจากบอท", bot: true });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(texts.length, 0);
});

test("ai-mod: ข้อความสั้นกว่า minLength ไม่ส่งตรวจ", async () => {
  const texts = mockClassify("auto", 0.99);
  const m = mockMessage({ content: "ก" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(texts.length, 0);
});

test("ai-mod: ปิดระบบ (enabled=false) → ไม่ทำอะไร", async () => {
  const texts = mockClassify("auto", 0.99);
  config.aiMod.enabled = false;
  const m = mockMessage({ content: "ข้อความ toxic จัด ๆ" });
  assert.equal(await handleAiMod(m.msg), false);
  assert.equal(texts.length, 0);
  config.aiMod.enabled = true;
});
