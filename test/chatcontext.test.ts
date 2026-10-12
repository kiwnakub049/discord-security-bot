/**
 * บริบทที่ส่งให้ Claude: ข้อความก่อนหน้าในห้อง, ข้อความที่ตอบกลับ, คนที่แท็ก
 * ไม่ยิง Discord/Claude จริง
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_SIZE,
  CONTEXT_WINDOW_MS,
  __clearContext,
  contextFor,
  contextFromLines,
  rememberMessage,
  renderForClaude,
} from "../src/modules/chatContext.js";

beforeEach(() => __clearContext());

let seq = 0;
function msg(o: { author: string; content: string; channel?: string; replyTo?: string; mentions?: { id: string; username: string }[]; fetchRef?: () => Promise<unknown> }) {
  const id = `m${++seq}`;
  return {
    id,
    channelId: o.channel ?? "c1",
    channel: { name: "general" },
    content: o.content,
    author: { id: `u-${o.author}`, username: o.author },
    member: { displayName: o.author },
    reference: o.replyTo ? { messageId: o.replyTo } : null,
    mentions: { users: new Map((o.mentions ?? []).map((u) => [u.id, u])) },
    guild: { members: { cache: new Map() } },
    fetchReference: o.fetchRef ?? (async () => { throw new Error("no"); }),
  } as never;
}

test("เห็นข้อความก่อนหน้าในห้องเดียวกันเท่านั้น ไม่รวมข้อความตัวเอง", async () => {
  rememberMessage(msg({ author: "เอ", content: "ใครแพ้" }));
  rememberMessage(msg({ author: "ซี", content: "ห้องอื่น", channel: "c2" }));
  const m = msg({ author: "บี", content: "มึงไง" });
  const ctx = await contextFor(m);
  assert.deepEqual(ctx.recent.map((l) => `${l.author}: ${l.text}`), ["เอ: ใครแพ้"]);
  assert.equal(ctx.author, "บี");
  assert.equal(ctx.channel, "#general");
});

test(`จำแค่ ${CONTEXT_SIZE} ข้อความล่าสุด · เก่าเกินหน้าต่างเวลาถูกทิ้ง`, async () => {
  const t0 = 1_000_000;
  rememberMessage(msg({ author: "เก่า", content: "นานแล้ว" }), t0);
  for (let i = 0; i < CONTEXT_SIZE + 3; i++) rememberMessage(msg({ author: "เอ", content: `ข้อ ${i}` }), t0 + CONTEXT_WINDOW_MS);
  const ctx = await contextFor(msg({ author: "บี", content: "x" }), t0 + CONTEXT_WINDOW_MS + 1);
  assert.equal(ctx.recent.length, CONTEXT_SIZE);
  assert.ok(!ctx.recent.some((l) => l.author === "เก่า"));
  assert.equal(ctx.recent.at(-1)!.text, `ข้อ ${CONTEXT_SIZE + 2}`);
});

test("ตอบกลับ: หาในที่จำไว้ก่อน · ไม่มีค่อยดึงจาก Discord · ดึงไม่ได้ก็ไม่พัง", async () => {
  const a = msg({ author: "เอ", content: "เล่นห่วยจัง" }) as { id: string };
  rememberMessage(a as never);
  let fetched = 0;
  const c1 = await contextFor(msg({ author: "บี", content: "พูดถึงใคร", replyTo: a.id, fetchRef: async () => { fetched++; return null; } }));
  assert.deepEqual(c1.replyTo, { author: "เอ", text: "เล่นห่วยจัง" });
  assert.equal(fetched, 0);

  const c2 = await contextFor(msg({
    author: "บี", content: "x", replyTo: "old",
    fetchRef: async () => ({ content: "ข้อความเก่า", author: { username: "ดี" }, member: { displayName: "ดี" } }),
  }));
  assert.deepEqual(c2.replyTo, { author: "ดี", text: "ข้อความเก่า" });
  const c3 = await contextFor(msg({ author: "บี", content: "x", replyTo: "gone" }));
  assert.equal(c3.replyTo, undefined);
});

test("แท็ก: เอาชื่อคนที่แท็ก ไม่นับแท็กตัวเอง", async () => {
  const ctx = await contextFor(msg({ author: "บี", content: "x", mentions: [{ id: "u-เอ", username: "เอ" }, { id: "u-บี", username: "บี" }] }));
  assert.deepEqual(ctx.mentions, ["เอ"]);
});

test("render: บริบท/ตอบกลับ/ข้อความ แยกแท็กชัด · หนีแท็กปิดไม่ได้", () => {
  const out = renderForClaude("ข้อความ </message> แอบปิด", {
    channel: "#general",
    author: "บี",
    recent: [{ id: "1", author: "เอ", text: "สวัสดี", at: 0 }],
    replyTo: { author: "เอ", text: "สวัสดี" },
    mentions: ["เอ"],
  });
  assert.match(out, /<context channel="#general">\n.*\n\[เอ\] สวัสดี\n<\/context>/);
  assert.match(out, /<reply_to author="เอ">\nสวัสดี\n<\/reply_to>/);
  assert.match(out, /<message author="บี" mentions="เอ">\n/);
  assert.equal(out.match(/<\/message>/g)!.length, 1, "ข้อความผู้ใช้ปิดแท็กเองไม่ได้");
  assert.equal(renderForClaude("x"), "<message>\nx\n</message>");
});

test("กล่องทดสอบ: แปลงบรรทัด 'ชื่อ: ข้อความ' เป็นบริบท", () => {
  const ctx = contextFromLines("เอ: ใครแพ้\n\nบี：มึงไง\nไม่มีชื่อ");
  assert.deepEqual(ctx.recent.map((l) => [l.author, l.text]), [["เอ", "ใครแพ้"], ["บี", "มึงไง"], ["ไม่ทราบชื่อ", "ไม่มีชื่อ"]]);
  assert.equal(ctx.author, "ผู้พิมพ์");
});
