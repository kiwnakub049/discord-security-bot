/**
 * แชททีม: ห้องรวม/ห้องส่วนตัว, สิทธิ์เข้าห้อง, ไฟล์แนบ, แท็ก, ยังไม่อ่าน, ลบของเก่า 90 วัน
 * ใช้ server จริง (ไม่มีบอท) + session ที่สร้างตรง + ตารางยศจำลอง · DB/ไฟล์ชั่วคราวใน tmp
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

const DIR = mkdtempSync(join(tmpdir(), "botteam-"));
process.env.BOT_DB_PATH = join(DIR, "test.db");
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

const PORT = 3870;
const BASE = `http://127.0.0.1:${PORT}`;
const A = "111111111111111111"; // admin
const B = "222222222222222222"; // mod
const C = "333333333333333333"; // mod
const OUT = "444444444444444444"; // ไม่ใช่ทีม
const grants = new Map([
  [A, { role: "admin" as const, name: "alice" }],
  [B, { role: "mod" as const, name: "bob" }],
  [C, { role: "mod" as const, name: "carol" }],
]);

let server: Server;
const cookie: Record<string, string> = {};
type Store = typeof import("../src/store/teamChatStore.js");
let store: Store;

before(async () => {
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.web.port = PORT;
  config.web.host = "127.0.0.1";
  const { createSession } = await import("../src/auth/session.js");
  const { COOKIE_NAME } = await import("../src/web/middleware/auth.js");
  for (const id of [A, B, C, OUT]) cookie[id] = `${COOKIE_NAME}=${createSession(id)}`;
  store = await import("../src/store/teamChatStore.js");
  const { startWebServer } = await import("../src/web/server.js");
  server = startWebServer(undefined, { access: async (id) => grants.get(id) ?? null });
  await new Promise((r) => setTimeout(r, 300));
});

after(() => server?.close());

const call = (who: string, path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { Cookie: cookie[who]!, Origin: BASE, "Content-Type": "application/json", ...init.headers },
  });
const post = (who: string, path: string, body: unknown) =>
  call(who, path, { method: "POST", body: JSON.stringify(body) });
const upload = (who: string, name: string, type: string, data: Uint8Array) =>
  call(who, `/api/team/files?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  });

const DM_AB = `dm:${A}:${B}`;

test("dmRoom เรียง id เสมอ · dmMembers ปฏิเสธรูปแบบผิด", () => {
  assert.equal(store.dmRoom(B, A), DM_AB);
  assert.deepEqual(store.dmMembers(DM_AB), [A, B]);
  assert.equal(store.dmMembers(`dm:${B}:${A}`), null, "ต้องเรียงน้อยไปมาก");
  assert.equal(store.dmMembers(`dm:${A}:${A}`), null);
  assert.equal(store.dmMembers("dm:abc:def"), null);
});

test("คนนอกทีมเข้าไม่ได้เลย", async () => {
  assert.equal((await call(OUT, "/api/team/rooms")).status, 401);
});

test("ห้องรวม: ส่ง/อ่าน + ยังไม่อ่านของคนอื่นเพิ่ม ของตัวเองไม่นับ", async () => {
  const r = await post(A, "/api/team/messages", { room: "general", body: "สวัสดีทีม" });
  assert.equal(r.status, 200);
  const sent = (await r.json()).message;
  const list = await (await call(B, "/api/team/messages?room=general")).json();
  assert.equal(list.at(-1).body, "สวัสดีทีม");
  assert.equal(list.at(-1).authorName, "alice");

  assert.deepEqual(await (await call(B, "/api/team/unread")).json(), { unread: 1, mentioned: false });
  assert.deepEqual(await (await call(A, "/api/team/unread")).json(), { unread: 0, mentioned: false });

  await post(B, "/api/team/read", { room: "general", lastId: sent.id });
  assert.equal((await (await call(B, "/api/team/unread")).json()).unread, 0);
});

test("poll: after= ได้เฉพาะข้อความใหม่", async () => {
  const all = await (await call(A, "/api/team/messages?room=general")).json();
  const last = all.at(-1).id;
  await post(C, "/api/team/messages", { room: "general", body: "ใหม่" });
  const fresh = await (await call(A, `/api/team/messages?room=general&after=${last}`)).json();
  assert.deepEqual(fresh.map((m: { body: string }) => m.body), ["ใหม่"]);
});

test("ห้องส่วนตัว: คนที่สามอ่าน/ส่งไม่ได้ · คุยกับคนนอกทีมไม่ได้", async () => {
  assert.equal((await post(A, "/api/team/messages", { room: DM_AB, body: "ลับ" })).status, 200);
  assert.equal((await call(C, `/api/team/messages?room=${DM_AB}`)).status, 404);
  assert.equal((await post(C, "/api/team/messages", { room: DM_AB, body: "แอบ" })).status, 404);
  const toOut = store.dmRoom(A, OUT);
  assert.equal((await post(A, "/api/team/messages", { room: toOut, body: "x" })).status, 404);
  const bRooms = await (await call(B, "/api/team/rooms")).json();
  assert.ok(bRooms.some((r: { room: string }) => r.room === DM_AB));
  const cRooms = await (await call(C, "/api/team/rooms")).json();
  assert.ok(!cRooms.some((r: { room: string }) => r.room === DM_AB));
});

test("แท็ก: ขึ้นสถานะโดนแท็ก · ในห้อง DM แท็กคนนอกห้อง/ตัวเอง/คนนอกทีมถูกตัดทิ้ง", async () => {
  const r = await post(B, "/api/team/messages", {
    room: "general",
    body: "@alice ช่วยดูหน่อย",
    mentions: [A, B, OUT, "not-an-id"],
  });
  assert.deepEqual((await r.json()).message.mentions, [A]);
  assert.equal((await (await call(A, "/api/team/unread")).json()).mentioned, true);

  const dm = await post(A, "/api/team/messages", { room: DM_AB, body: "x", mentions: [B, C] });
  assert.deepEqual((await dm.json()).message.mentions, [B], "carol ไม่อยู่ในห้องนี้");
});

test("@all: แท็กทุกคนในห้องที่หน้าเว็บส่งมา (ยังกรองคนนอกทีม/ตัวเองเหมือนเดิม)", async () => {
  const r = await post(A, "/api/team/messages", { room: "general", body: "@all ประชุม 2 ทุ่ม", mentions: [A, B, C, OUT] });
  assert.deepEqual((await r.json()).message.mentions.sort(), [B, C]);
  assert.equal((await (await call(C, "/api/team/unread")).json()).mentioned, true);
});

test("notifyMentions: @all บอกว่าแท็กทุกคน · DM ไม่ได้ก็ข้ามไป", async () => {
  const { notifyMentions } = await import("../src/modules/teamChat.js");
  const sent: Record<string, string> = {};
  const client = {
    users: {
      fetch: async (id: string) => ({
        send: async (t: string) => {
          if (id === C) throw new Error("Cannot send messages to this user");
          sent[id] = t;
        },
      }),
    },
  } as never;
  const msg = { id: 1, room: "general", authorId: A, authorName: "alice", body: "@all ประชุม", mentions: [B, C], createdAt: 0, files: [], replyTo: null };
  assert.deepEqual(await notifyMentions(client, msg, true), [B]);
  assert.match(sent[B]!, /alice\*\* แท็กทุกคนในแชททีม \(ห้องรวม\)/);
  assert.match(sent[B]!, /> @all ประชุม/);
  await notifyMentions(client, { ...msg, mentions: [B] }, false);
  assert.match(sent[B]!, /แท็กคุณ/);
});

test("ไฟล์: อัป → แนบ → คนในห้องโหลดได้ · รูปเปิดในหน้า · ไฟล์อื่นบังคับดาวน์โหลด", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const up = await (await upload(A, "หลักฐาน.png", "image/png", png)).json();
  assert.ok(up.ok);
  assert.equal(up.size, png.length);

  // ยังไม่ส่ง: คนอัปเห็นได้ (พรีวิว) คนอื่นไม่เห็น
  assert.equal((await call(A, `/api/team/files/${up.id}`)).status, 200);
  assert.equal((await call(B, `/api/team/files/${up.id}`)).status, 404);

  const html = await (await upload(A, "x.html", "text/html", new TextEncoder().encode("<script>1</script>"))).json();
  const sent = await post(A, "/api/team/messages", { room: DM_AB, body: "", files: [up.id, html.id] });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).message.files.length, 2);

  const img = await call(B, `/api/team/files/${up.id}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.match(img.headers.get("content-disposition") ?? "", /^inline/);
  assert.match(img.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), png);

  const h = await call(B, `/api/team/files/${html.id}`);
  assert.equal(h.headers.get("content-type"), "application/octet-stream");
  assert.match(h.headers.get("content-disposition") ?? "", /^attachment/);

  assert.equal((await call(C, `/api/team/files/${up.id}`)).status, 404, "carol ไม่อยู่ในห้อง DM");
});

test("ไฟล์: แนบไฟล์คนอื่น/แนบซ้ำไม่ได้ · ไฟล์ใหญ่เกินถูกปฏิเสธ", async () => {
  const up = await (await upload(B, "a.txt", "text/plain", new Uint8Array([1]))).json();
  assert.equal((await post(A, "/api/team/messages", { room: "general", files: [up.id] })).status, 400);
  assert.equal((await post(B, "/api/team/messages", { room: "general", files: [up.id] })).status, 200);
  assert.equal((await post(B, "/api/team/messages", { room: "general", files: [up.id] })).status, 400);

  const big = await call(A, "/api/team/files?name=big.bin", {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(100_000_001) },
    body: new Uint8Array(1),
  }).catch(() => null);
  // server ตอบ 413 ทันทีจาก content-length (fetch อาจตัดก่อนได้เพราะ length ไม่ตรง)
  if (big) assert.equal(big.status, 413);
});

test("ตอบกลับ: แนบต้นทางย่อ ๆ · แจ้งเจ้าของต้นทาง · ข้ามห้อง/id มั่วไม่ได้", async () => {
  const orig = (await (await post(C, "/api/team/messages", { room: "general", body: "ต้นทาง\nสองบรรทัด" })).json()).message;
  const r = await post(B, "/api/team/messages", { room: "general", body: "ตอบนะ", replyTo: orig.id });
  assert.equal(r.status, 200);
  const msg = (await r.json()).message;
  assert.deepEqual(msg.replyTo, { id: orig.id, authorId: C, authorName: "carol", excerpt: "ต้นทาง สองบรรทัด", files: 0, gone: false });
  assert.deepEqual(msg.mentions, [C], "เจ้าของต้นทางโดนแจ้ง");
  assert.equal((await (await call(C, "/api/team/unread")).json()).mentioned, true);

  const list = await (await call(A, "/api/team/messages?room=general")).json();
  assert.equal(list.find((m: { id: number }) => m.id === msg.id).replyTo.id, orig.id);

  // ตอบข้อความตัวเอง = ไม่แจ้งตัวเอง
  const self = await (await post(C, "/api/team/messages", { room: "general", body: "ต่อ", replyTo: orig.id })).json();
  assert.deepEqual(self.message.mentions, []);

  // ต้นทางอยู่ห้อง DM → ตอบจากห้องรวมไม่ได้ (กันแอบดูข้อความห้องอื่นผ่าน excerpt)
  const dm = (await (await post(A, "/api/team/messages", { room: DM_AB, body: "ลับมาก" })).json()).message;
  assert.equal((await post(C, "/api/team/messages", { room: "general", body: "x", replyTo: dm.id })).status, 400);
  assert.equal((await post(B, "/api/team/messages", { room: "general", body: "x", replyTo: 999999 })).status, 400);
  assert.equal((await post(B, "/api/team/messages", { room: "general", body: "x", replyTo: "1" })).status, 400);
});

test("notifyMentions: โดนแจ้งเพราะถูกตอบกลับ → บอกว่าตอบกลับ", async () => {
  const { notifyMentions } = await import("../src/modules/teamChat.js");
  const sent: Record<string, string> = {};
  const client = { users: { fetch: async (id: string) => ({ send: async (t: string) => void (sent[id] = t) }) } } as never;
  const replyTo = { id: 1, authorId: B, authorName: "bob", excerpt: "x", files: 0, gone: false };
  await notifyMentions(client, { id: 2, room: "general", authorId: A, authorName: "alice", body: "โอเค", mentions: [B], createdAt: 0, files: [], replyTo }, false);
  assert.match(sent[B]!, /alice\*\* ตอบกลับข้อความของคุณ/);
});

test("ข้อความว่างไม่มีไฟล์ = 400", async () => {
  assert.equal((await post(A, "/api/team/messages", { room: "general", body: "   " })).status, 400);
});

test("ลบของเก่าเกิน 90 วัน + ไฟล์ที่อัปค้าง > 1 วัน", async () => {
  const keep = await (await upload(A, "k.png", "image/png", new Uint8Array([1]))).json();
  await post(A, "/api/team/messages", { room: "general", body: "เก็บ", files: [keep.id] });
  const orphan = await (await upload(A, "o.png", "image/png", new Uint8Array([1]))).json();

  const future = Date.now() + store.RETENTION_MS + 60_000;
  const r = store.pruneTeamChat(future);
  assert.ok(r.messages > 0);
  assert.ok(r.files >= 2);
  assert.ok(!existsSync(store.filePath(keep.id)));
  assert.ok(!existsSync(store.filePath(orphan.id)));
  assert.deepEqual(await (await call(A, "/api/team/messages?room=general")).json(), []);
});
