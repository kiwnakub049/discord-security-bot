/**
 * แจ้งเตือนมือถือ (Web Push): สมัคร/เลือกเรื่อง/เลิก, การ์ดใหม่ในคิว, แชททีม (แท็ก/ส่วนตัว/ห้องรวม)
 * ใช้ server จริง + ตัวส่ง push ปลอม (ไม่ยิง Google/Apple) · DB ชั่วคราวใน tmp
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

console.log = () => {};
process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botpush-")), "test.db");
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";
const PORT = 3874;
const BASE = `http://127.0.0.1:${PORT}`;
const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";
const grants = new Map([
  [A, { role: "admin" as const, name: "alice" }],
  [B, { role: "mod" as const, name: "bob" }],
  [C, { role: "mod" as const, name: "carol" }],
]);

const sent: { endpoint: string; payload: { title: string; body: string; tag: string; url: string } }[] = [];
const goneEndpoints = new Set<string>();
let server: Server;
const cookie: Record<string, string> = {};

before(async () => {
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.web.port = PORT;
  config.web.host = "127.0.0.1";
  const { createSession } = await import("../src/auth/session.js");
  const { COOKIE_NAME } = await import("../src/web/middleware/auth.js");
  for (const id of [A, B, C]) cookie[id] = `${COOKIE_NAME}=${createSession(id)}`;
  const { startWebServer } = await import("../src/web/server.js");
  server = startWebServer(undefined, {
    access: async (id) => grants.get(id) ?? null,
    pushSender: async (sub, payload) => {
      if (goneEndpoints.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  });
  await new Promise((r) => setTimeout(r, 300));
});
after(() => server?.close());
beforeEach(() => void (sent.length = 0));

const ep = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}`;
const post = (who: string, path: string, body: unknown, lang = "th") =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Cookie: cookie[who]!, Origin: BASE, "Content-Type": "application/json", "X-Lang": lang },
    body: JSON.stringify(body),
  });
const subscribe = (who: string, topics: string[], lang = "th", endpoint = ep(who)) =>
  post(who, "/api/push/subscribe", { subscription: { endpoint, keys: { p256dh: "BPk3abc_-", auth: "xyz123" } }, topics }, lang);
const settle = () => new Promise((r) => setTimeout(r, 100));

test("สมัคร: endpoint ต้องเป็น push service จริง (กัน SSRF) · keys ต้องถูกรูปแบบ", async () => {
  const bad = (endpoint: string) =>
    post(A, "/api/push/subscribe", { subscription: { endpoint, keys: { p256dh: "a", auth: "b" } }, topics: [] });
  assert.equal((await bad("http://127.0.0.1:3000/x")).status, 400);
  assert.equal((await bad("https://evil.example/fcm.googleapis.com")).status, 400);
  assert.equal((await post(A, "/api/push/subscribe", { subscription: { endpoint: ep(A), keys: { p256dh: "a b", auth: "x" } } })).status, 400);
  const ok = await subscribe(A, ["queue", "nope", "mention"]);
  assert.deepEqual((await ok.json()).topics, ["queue", "mention"]);
  assert.deepEqual(await (await post(A, "/api/push/status", { endpoint: ep(A) })).json(), { subscribed: true, topics: ["queue", "mention"] });
  assert.equal((await (await post(B, "/api/push/status", { endpoint: ep(A) })).json()).subscribed, false, "ของคนอื่นดูไม่ได้");
});

test("การ์ดใหม่ในคิว → ส่งให้เครื่องที่รับ queue · หัวข้อตามภาษาเครื่อง · ต่อท้ายการ์ดเดิมไม่ส่งซ้ำ", async () => {
  await subscribe(B, ["queue"], "en");
  await subscribe(C, ["general"]);
  const { enqueue } = await import("../src/store/queueStore.js");
  enqueue({ category: "ai-toxic", subjectId: "999999999999999999", title: "baduser#0", detail: "คะแนน 0.70" });
  await settle();
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), [ep(A), ep(B)]);
  assert.equal(sent.find((s) => s.endpoint === ep(A))!.payload.title, "Claude จับข้อความ");
  assert.equal(sent.find((s) => s.endpoint === ep(B))!.payload.title, "Flagged by Claude");
  assert.match(sent[0]!.payload.body, /baduser#0 · คะแนน 0.70/);
  sent.length = 0;
  enqueue({ category: "ai-toxic", subjectId: "999999999999999999", title: "baduser#0" });
  await settle();
  assert.equal(sent.length, 0);
});

test("แชททีมห้องรวม: คนถูกแท็กได้ 'แท็กคุณ' · คนอื่นที่รับห้องรวมได้ข้อความปกติ · คนส่งไม่ได้", async () => {
  // A: queue+mention · B: queue (ไม่รับแชท) · C: general
  await post(A, "/api/team/messages", { room: "general", body: "@bob @carol ดูหน่อย", mentions: [B, C] });
  await settle();
  // B ถูกแท็กแต่ไม่ได้รับเรื่องแชท → ไม่ได้ · C ถูกแท็ก ไม่รับ mention แต่รับห้องรวม → ได้แบบห้องรวม
  assert.deepEqual(sent.map((s) => s.endpoint), [ep(C)]);
  assert.match(sent[0]!.payload.title, /alice · ห้องรวม/);
  assert.equal(sent[0]!.payload.url, "/team");

  sent.length = 0;
  await post(C, "/api/team/messages", { room: "general", body: "@alice ช่วยที", mentions: [A] });
  await settle();
  assert.deepEqual(sent.map((s) => [s.endpoint, s.payload.title]), [[ep(A), "carol แท็กคุณ"]]);
});

test("ข้อความส่วนตัว: ถึงอีกฝ่ายเท่านั้น", async () => {
  const room = `dm:${A}:${C}`;
  await post(C, "/api/team/messages", { room, body: "ลับ" });
  await settle();
  assert.deepEqual(sent.map((s) => [s.endpoint, s.payload.title, s.payload.body]), [[ep(A), "carol (ส่วนตัว)", "ลับ"]]);
});

test("ถอดยศแล้วไม่ได้รับ · เครื่องที่ยกเลิกไปแล้ว (410) ถูกลบทิ้ง", async () => {
  const { enqueue } = await import("../src/store/queueStore.js");
  grants.delete(B);
  goneEndpoints.add(ep(A));
  try {
    enqueue({ category: "suspicious-member", subjectId: "888888888888888888", title: "x" });
    await settle();
    assert.equal(sent.length, 0);
    assert.equal((await (await post(A, "/api/push/status", { endpoint: ep(A) })).json()).subscribed, false);
  } finally {
    grants.set(B, { role: "mod", name: "bob" });
    goneEndpoints.clear();
  }
});

test("เลิกรับ: ลบได้แค่ของตัวเอง · ปุ่มทดสอบส่งถึงเครื่องนี้", async () => {
  assert.equal((await (await post(A, "/api/push/unsubscribe", { endpoint: ep(B) })).json()).ok, false);
  const r = await post(B, "/api/push/test", { endpoint: ep(B) }, "en");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).message, "Sent — it should pop up within a few seconds");
  assert.equal(sent.at(-1)!.endpoint, ep(B));
  assert.equal((await (await post(B, "/api/push/unsubscribe", { endpoint: ep(B) })).json()).ok, true);
  assert.equal((await post(B, "/api/push/test", { endpoint: ep(B) })).status, 404);
});

test("sw.js และ manifest เปิดได้ก่อน login", async () => {
  const sw = await fetch(`${BASE}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /addEventListener\("push"/);
  const mf = await fetch(`${BASE}/manifest.webmanifest`);
  assert.equal(mf.status, 200);
  assert.match(mf.headers.get("content-type") ?? "", /manifest\+json/);
});
