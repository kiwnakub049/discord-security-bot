/**
 * ข้อความจาก server เป็นอังกฤษเมื่อหน้าเว็บเลือก EN
 * - tr(): ตรงตัว + มีตัวแปร (และแปลชิ้นย่อยที่ซ้อนอยู่)
 * - middleware: endpoint จริงตอบ error เป็นอังกฤษเมื่อมี X-Lang: en · ไม่มี = ไทยเหมือนเดิม
 * - ป้ายหมวดในคิวเป็นอังกฤษ
 * - หน้า login: ?lang=en วาดอังกฤษ + ตั้ง cookie
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

console.log = () => {};
process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "boti18n-")), "test.db");
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";
const PORT = 3873;
const BASE = `http://127.0.0.1:${PORT}`;
const MOD = "222222222222222222";

let server: Server;
let cookie = "";
let tr: typeof import("../src/web/i18n.js").tr;

before(async () => {
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.web.port = PORT;
  config.web.host = "127.0.0.1";
  ({ tr } = await import("../src/web/i18n.js"));
  const { createSession } = await import("../src/auth/session.js");
  const { COOKIE_NAME } = await import("../src/web/middleware/auth.js");
  cookie = `${COOKIE_NAME}=${createSession(MOD)}`;
  const { enqueue } = await import("../src/store/queueStore.js");
  enqueue({ category: "ai-toxic", subjectId: "555555555555555555", title: "u#0" });
  const { startWebServer } = await import("../src/web/server.js");
  server = startWebServer(undefined, { access: async (id) => (id === MOD ? { role: "mod", name: "mod_user" } : null) });
  await new Promise((r) => setTimeout(r, 300));
});

after(() => server?.close());

test("tr: ตรงตัว · มีตัวแปร · แปลชิ้นย่อยซ้อน · ไม่รู้จัก = ไทยเดิม", () => {
  assert.equal(tr("ไม่พบแชทนี้", "en"), "Chat not found");
  assert.equal(tr("ไม่พบแชทนี้", "th"), "ไม่พบแชทนี้");
  assert.equal(tr("เตะออก 3 เครื่อง", "en"), "Signed out 3 device(s)");
  assert.equal(tr("ล็อก 5 ห้อง (พลาด 1)", "en"), "Locked 5 channel(s) (1 failed)");
  assert.equal(tr("แบนแล้ว 📨 DM แล้ว", "en"), "Banned 📨 DM sent");
  assert.equal(tr("timeout 30 นาที (DM ไม่ได้)", "en"), "Timed out for 30 min (couldn't DM)");
  assert.equal(
    tr("เตือนแล้ว (ครั้งที่ 3) → ลงโทษ: ไมค์แดง 1 ชม. (ยังไม่อยู่ห้องเสียง — จะปิดทันทีที่เข้า) — ปลดให้ <t:1:R> 📨 DM แล้ว", "en"),
    "Warned (#3) → punishment: server mute 1 h (not in voice yet — applies as soon as they join) — lifted <t:1:R> 📨 DM sent",
  );
  assert.equal(tr("เรื่องนี้ถูกตัดสินไปแล้วโดย คนอื่น", "en"), "Already decided by someone else");
  assert.equal(tr("เรื่องนี้ถูกตัดสินไปแล้วโดย bob", "en"), "Already decided by bob");
  assert.equal(tr(" (ลบ 2 ข้อความ · หายไปก่อนแล้ว 1)", "en"), " (deleted 2 · 1 already gone)");
  assert.equal(tr("ข้อความแปลก ๆ ที่ไม่มีในพจนานุกรม", "en"), "ข้อความแปลก ๆ ที่ไม่มีในพจนานุกรม");
  assert.equal(
    tr("ผู้เล่นสูงสุด: ต้องอยู่ระหว่าง 1–64 · แท็ก: ยาวเกิน 100 ตัวอักษร", "en"),
    "Max players: must be between 1–64 · Tags: longer than 100 characters",
  );
  assert.equal(tr("ในบ้าน (eth0)", "en"), "Home network (eth0)");
});

const get = (path: string, lang?: string) =>
  fetch(`${BASE}${path}`, { headers: { Cookie: cookie, ...(lang ? { "X-Lang": lang } : {}) } });

test("middleware: error จาก endpoint จริงเป็นอังกฤษเมื่อ X-Lang: en", async () => {
  const en = await (await get("/api/queue/no-such", "en")).json();
  assert.equal(en.message, "No such category");
  const th = await (await get("/api/queue/no-such")).json();
  assert.equal(th.message, "ไม่มีหมวดนี้");
  const viaCookie = await (
    await fetch(`${BASE}/api/queue/no-such`, { headers: { Cookie: `${cookie}; lang=en` } })
  ).json();
  assert.equal(viaCookie.message, "No such category");
});

test("คิว: ป้ายหมวด/ปุ่มเป็นอังกฤษ", async () => {
  const q = await (await get("/api/queue", "en")).json();
  const stack = q.stacks.find((s: { key: string }) => s.key === "ai-toxic");
  assert.equal(stack.label, "Flagged by Claude");
  assert.equal(stack.unit, "messages");
  assert.ok(stack.outcomes.some((o: { label: string }) => o.label === "Allow (Claude was wrong)"));
  assert.ok(q.idle.every((c: { label: string }) => !/[฀-๿]/.test(c.label)), "หมวดว่างก็ต้องอังกฤษ");
  const th = await (await get("/api/queue")).json();
  assert.equal(th.stacks.find((s: { key: string }) => s.key === "ai-toxic").label, "Claude จับข้อความ");
});

test("หน้า login: ?lang=en วาดอังกฤษ + ตั้ง cookie · ไม่มี script", async () => {
  const r = await fetch(`${BASE}/login?lang=en`);
  const html = await r.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Sign in with Discord/);
  assert.match(html, /"Open Sans"/);
  assert.match(html, /href="\/login\?lang=th"/);
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/, ""), /เข้าสู่ระบบ/);
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ""), /<script[\s>]/i);
  assert.ok(r.headers.getSetCookie().some((c) => /^lang=en;/.test(c)));

  const err = await (await fetch(`${BASE}/login?error=norole`, { headers: { Cookie: "lang=en" } })).text();
  assert.match(err, /doesn't have an admin or mod role/);
  const th = await (await fetch(`${BASE}/login`)).text();
  assert.match(th, /เข้าสู่ระบบด้วย Discord/);
  assert.match(th, /href="\/login\?lang=en"/);
});

test("ตั้งค่าบอท + จอ OLED: หัวข้อ/ป้ายเป็นอังกฤษ (key/ตัวเลือกไม่เปลี่ยน)", async () => {
  const settings = (await (await get("/api/settings", "en")).json()) as { section: string; items: { key: string; label: string }[] }[];
  const thai = /[\u0E00-\u0E7F]/;
  assert.ok(settings.length > 0);
  for (const s of settings) {
    assert.doesNotMatch(s.section, thai, s.section);
    for (const i of s.items) assert.doesNotMatch(i.label, thai, i.label);
  }
  assert.ok(settings.flatMap((s) => s.items).some((i) => i.key === "antiRaid.enabled" && i.label === "Enabled"));
  const oled = await (await get("/api/oled", "en")).json();
  assert.ok(oled.pages.every((p: { label: string }) => !thai.test(p.label)));
});
