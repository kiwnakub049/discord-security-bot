/**
 * /ticket → คิว "Ticket แอดมิน"
 * คนละ 1 เรื่องที่ค้าง, คำตอบเป็น ephemeral, ปิดเรื่องแล้ว DM แจ้ง (DM ไม่ได้ต้องไม่พัง)
 * ใช้ mock interaction/client (ไม่ต่อ Discord) และ DB ชั่วคราวใน tmp
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-ticket.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

type Ticket = typeof import("../src/modules/ticket.js");
type Store = typeof import("../src/store/queueStore.js");
let ticket: Ticket;
let store: Store;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  ticket = await import("../src/modules/ticket.js");
  store = await import("../src/store/queueStore.js");
});

function mockInteraction(userId: string, topic: string, detail: string) {
  const replies: { content: string; flags?: number }[] = [];
  const interaction = {
    user: { id: userId },
    options: {
      getString: (name: string) => (name === "topic" ? topic : detail),
    },
    reply: async (r: { content: string; flags?: number }) => void replies.push(r),
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

test("openTicket: เรื่องแรกสร้างใหม่ เรื่องที่สองของคนเดิมได้ id เดิมกลับมา", () => {
  const a = ticket.openTicket("t-1", "ขอยศ", "ช่วยดูให้หน่อย");
  const b = ticket.openTicket("t-1", "อีกเรื่อง", "...");
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.id, b.id);
  assert.equal(store.getItem(a.id)?.title, "ขอยศ", "เรื่องเดิมต้องไม่ถูกทับ");
  // คนอื่นเปิดได้ตามปกติ
  assert.equal(ticket.openTicket("t-2", "x", "y").created, true);
});

test("ปิด ticket แล้วเปิดเรื่องใหม่ได้", () => {
  const first = ticket.openTicket("t-3", "เรื่องแรก", "a");
  store.resolve(first.id, "done", "mod");
  const next = ticket.openTicket("t-3", "เรื่องสอง", "b");
  assert.equal(next.created, true);
  assert.notEqual(next.id, first.id);
});

test("/ticket ตอบแบบ ephemeral และบอกเมื่อมี ticket ค้างอยู่", async () => {
  const { ticket: cmd } = await import("../src/commands/ticket.js");

  const one = mockInteraction("t-4", "แจ้งปัญหา", "รายละเอียด");
  await cmd.execute(one.interaction);
  assert.equal(one.replies[0]?.flags, MessageFlags.Ephemeral);
  assert.match(one.replies[0]?.content ?? "", /ส่ง ticket/);
  const row = store.listOpen(ticket.TICKET_CATEGORY).find((r) => r.subject_id === "t-4");
  assert.equal(row?.title, "แจ้งปัญหา");
  assert.equal(row?.detail, "รายละเอียด");

  const two = mockInteraction("t-4", "อีกเรื่อง", "...");
  await cmd.execute(two.interaction);
  assert.equal(two.replies[0]?.flags, MessageFlags.Ephemeral);
  assert.match(two.replies[0]?.content ?? "", /คุณมี ticket ค้างอยู่/);
});

test("/ticket ลงทะเบียนในรายการคำสั่งแล้ว", async () => {
  const { commands } = await import("../src/commands/index.js");
  assert.ok(commands.has("ticket"));
});

test("notifyTicketClosed: DM บอกชื่อเรื่อง · DM ไม่ได้ก็ไม่พัง", async () => {
  const sent: string[] = [];
  const ok = {
    users: { fetch: async () => ({ send: async (t: string) => void sent.push(t) }) },
  } as unknown as Client;
  await ticket.notifyTicketClosed(ok, { subject_id: "t-5", title: "ขอยศ" }, "เซิร์ฟทดสอบ");
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /ขอยศ/);
  assert.match(sent[0] ?? "", /เซิร์ฟทดสอบ/);

  const closedDm = {
    users: {
      fetch: async () => ({
        send: async () => {
          throw new Error("Cannot send messages to this user");
        },
      }),
    },
  } as unknown as Client;
  await ticket.notifyTicketClosed(closedDm, { subject_id: "t-5", title: "x" });

  const gone = {
    users: { fetch: async () => { throw new Error("Unknown User"); } },
  } as unknown as Client;
  await ticket.notifyTicketClosed(gone, { subject_id: "t-6", title: "x" });
});
