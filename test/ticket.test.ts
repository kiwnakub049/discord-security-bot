/**
 * /ticket → คิว "Ticket แอดมิน" + บทสนทนาตำรวจ ↔ แอดมินผ่าน DM ของบอท
 * เปิดได้เฉพาะยศตำรวจ, คนละ 1 เรื่องที่ค้าง, DM ที่ตำรวจตอบมาเข้าเรื่องที่ค้าง, แอดมินตอบแล้ว DM ต่อ
 * ใช้ mock interaction/client/message (ไม่ต่อ Discord) และ DB ชั่วคราวใน tmp
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
} from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-ticket.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

const POLICE = "999000111";

type Ticket = typeof import("../src/modules/ticket.js");
type Store = typeof import("../src/store/queueStore.js");
type Msgs = typeof import("../src/store/ticketStore.js");
type Config = typeof import("../src/config.js")["config"];
let ticket: Ticket;
let store: Store;
let msgs: Msgs;
let config: Config;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  ({ config } = await import("../src/config.js"));
  config.ticket.policeRoleId = POLICE;
  ticket = await import("../src/modules/ticket.js");
  store = await import("../src/store/queueStore.js");
  msgs = await import("../src/store/ticketStore.js");
});

function mockInteraction(
  userId: string,
  topic: string,
  detail: string,
  opts: { police?: boolean; dmOk?: boolean } = {},
) {
  const replies: { content: string; flags?: number }[] = [];
  const dms: string[] = [];
  const interaction = {
    user: {
      id: userId,
      tag: `user${userId}`,
      send: async (t: string) => {
        if (opts.dmOk === false) throw new Error("Cannot send messages to this user");
        dms.push(t);
      },
    },
    member: { roles: { cache: { has: (id: string) => opts.police !== false && id === POLICE } } },
    options: { getString: (name: string) => (name === "topic" ? topic : detail) },
    reply: async (r: { content: string; flags?: number }) => void replies.push(r),
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies, dms };
}

function mockDm(userId: string, content: string, attachments: string[] = []) {
  const reacted: string[] = [];
  const message = {
    author: { id: userId, bot: false, tag: `user${userId}` },
    partial: false,
    content,
    attachments: new Map(attachments.map((url, i) => [String(i), { url }])),
    react: async (e: string) => void reacted.push(e),
  } as unknown as Message;
  return { message, reacted };
}

const dmClient = (sent: string[], fail = false) =>
  ({
    users: {
      fetch: async () => ({
        send: async (t: string) => {
          if (fail) throw new Error("Cannot send messages to this user");
          sent.push(t);
        },
      }),
    },
  }) as unknown as Client;

test("openTicket: เรื่องแรกสร้างใหม่ เรื่องที่สองของคนเดิมได้ id เดิมกลับมา", () => {
  const a = ticket.openTicket("t-1", "ขอยศ", "ช่วยดูให้หน่อย");
  const b = ticket.openTicket("t-1", "อีกเรื่อง", "...");
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.id, b.id);
  assert.equal(store.getItem(a.id)?.title, "ขอยศ", "เรื่องเดิมต้องไม่ถูกทับ");
  // รายละเอียดตอนเปิด = ข้อความแรก · เปิดซ้ำต้องไม่เพิ่มข้อความ
  assert.deepEqual(
    msgs.listMessages(a.id).map((m) => [m.author_kind, m.body]),
    [["police", "ช่วยดูให้หน่อย"]],
  );
  assert.equal(ticket.openTicket("t-2", "x", "y").created, true);
});

test("ปิด ticket แล้วเปิดเรื่องใหม่ได้", () => {
  const first = ticket.openTicket("t-3", "เรื่องแรก", "a");
  store.resolve(first.id, "done", "mod");
  const next = ticket.openTicket("t-3", "เรื่องสอง", "b");
  assert.equal(next.created, true);
  assert.notEqual(next.id, first.id);
});

test("canOpenTicket: ยังไม่ตั้งยศ / ไม่ใช่ตำรวจ / ตำรวจ", () => {
  const member = (has: boolean) => ({ roles: { cache: { has: () => has } } }) as never;
  config.ticket.policeRoleId = "";
  assert.equal(ticket.canOpenTicket(member(true)), "no-role");
  config.ticket.policeRoleId = POLICE;
  assert.equal(ticket.canOpenTicket(member(false)), "not-police");
  assert.equal(ticket.canOpenTicket(null), "not-police");
  assert.equal(ticket.canOpenTicket(member(true)), "ok");
});

test("/ticket: ไม่ใช่ตำรวจ → ปฏิเสธ ไม่เข้าคิว", async () => {
  const { ticket: cmd } = await import("../src/commands/ticket.js");
  const r = mockInteraction("t-civ", "x", "y", { police: false });
  await cmd.execute(r.interaction);
  assert.equal(r.replies[0]?.flags, MessageFlags.Ephemeral);
  assert.match(r.replies[0]?.content ?? "", /เฉพาะตำรวจ/);
  assert.equal(store.openItemFor(ticket.TICKET_CATEGORY, "t-civ"), undefined);
});

test("/ticket: ยังไม่ตั้งยศตำรวจ → บอกว่ายังไม่เปิดใช้", async () => {
  const { ticket: cmd } = await import("../src/commands/ticket.js");
  config.ticket.policeRoleId = "";
  const r = mockInteraction("t-norole", "x", "y");
  await cmd.execute(r.interaction);
  config.ticket.policeRoleId = POLICE;
  assert.match(r.replies[0]?.content ?? "", /ยังไม่ได้ตั้งยศตำรวจ/);
  assert.equal(store.openItemFor(ticket.TICKET_CATEGORY, "t-norole"), undefined);
});

test("/ticket: ตำรวจเปิดได้ ตอบ ephemeral + DM ยืนยัน · เปิดซ้ำบอกว่ามีค้าง", async () => {
  const { ticket: cmd } = await import("../src/commands/ticket.js");

  const one = mockInteraction("t-4", "แจ้งปัญหา", "รายละเอียด");
  await cmd.execute(one.interaction);
  assert.equal(one.replies[0]?.flags, MessageFlags.Ephemeral);
  assert.match(one.replies[0]?.content ?? "", /ส่ง ticket/);
  assert.match(one.dms[0] ?? "", /แจ้งปัญหา/);
  const row = store.openItemFor(ticket.TICKET_CATEGORY, "t-4");
  assert.equal(row?.title, "แจ้งปัญหา");
  assert.equal(row?.detail, "รายละเอียด");

  const two = mockInteraction("t-4", "อีกเรื่อง", "...");
  await cmd.execute(two.interaction);
  assert.equal(two.replies[0]?.flags, MessageFlags.Ephemeral);
  assert.match(two.replies[0]?.content ?? "", /คุณมี ticket ค้างอยู่/);
  assert.equal(two.dms.length, 0, "เปิดซ้ำไม่ต้อง DM ยืนยันอีก");
});

test("/ticket: DM ยืนยันไม่ได้ → เรื่องยังเข้าคิว แต่เตือนให้เปิด DM", async () => {
  const { ticket: cmd } = await import("../src/commands/ticket.js");
  const r = mockInteraction("t-nodm", "เรื่อง", "รายละเอียด", { dmOk: false });
  await cmd.execute(r.interaction);
  assert.match(r.replies[0]?.content ?? "", /DM หาคุณไม่ได้/);
  assert.ok(store.openItemFor(ticket.TICKET_CATEGORY, "t-nodm"));
});

test("/ticket ลงทะเบียนในรายการคำสั่งแล้ว", async () => {
  const { commands } = await import("../src/commands/index.js");
  assert.ok(commands.has("ticket"));
});

test("handleTicketDm: มีเรื่องค้าง → เก็บเข้าบทสนทนา + react ✅", async () => {
  const { id } = ticket.openTicket("t-dm", "เรื่อง", "เริ่มต้น");
  const dm = mockDm("t-dm", "ตอบเพิ่มเติมครับ", ["https://cdn.example/a.png"]);
  assert.equal(await ticket.handleTicketDm(dm.message), true);
  assert.deepEqual(dm.reacted, ["✅"]);
  const last = msgs.listMessages(id).at(-1);
  assert.equal(last?.author_kind, "police");
  assert.equal(last?.body, "ตอบเพิ่มเติมครับ");
  assert.equal(last?.attachments, "https://cdn.example/a.png");
});

test("handleTicketDm: ไม่มีเรื่องค้าง / เรื่องปิดแล้ว → false (ให้ dmRelay จัดการต่อ)", async () => {
  assert.equal(await ticket.handleTicketDm(mockDm("nobody", "hi").message), false);
  const { id } = ticket.openTicket("t-closed", "เรื่อง", "x");
  store.resolve(id, "done", "mod");
  const dm = mockDm("t-closed", "ยังอยู่ไหม");
  assert.equal(await ticket.handleTicketDm(dm.message), false);
  assert.equal(dm.reacted.length, 0);
  assert.equal(msgs.listMessages(id).length, 1, "ต้องไม่เพิ่มข้อความเข้าเรื่องที่ปิดแล้ว");
});

test("replyToTicket: DM ได้ → delivered · DM ไม่ได้ → ยังเก็บ แต่ delivered=0", async () => {
  const { id } = ticket.openTicket("t-rep", "ขอยศ", "x");
  const item = store.getItem(id)!;

  const sent: string[] = [];
  const ok = await ticket.replyToTicket(dmClient(sent), item, { id: "777", name: "flick" }, "ขอหลักฐานเพิ่ม\nบรรทัดสอง");
  assert.equal(ok.delivered, true);
  assert.match(sent[0] ?? "", /flick/);
  assert.match(sent[0] ?? "", /> ขอหลักฐานเพิ่ม\n> บรรทัดสอง/);

  const bad = await ticket.replyToTicket(dmClient([], true), item, { id: "777", name: "flick" }, "ฮัลโหล");
  assert.equal(bad.delivered, false);

  const admin = msgs.listMessages(id).filter((m) => m.author_kind === "admin");
  assert.deepEqual(
    admin.map((m) => [m.body, m.delivered]),
    [
      ["ขอหลักฐานเพิ่ม\nบรรทัดสอง", 1],
      ["ฮัลโหล", 0],
    ],
  );
});

test("notifyTicketClosed: DM บอกชื่อเรื่อง · DM ไม่ได้ก็ไม่พัง", async () => {
  const sent: string[] = [];
  await ticket.notifyTicketClosed(dmClient(sent), { subject_id: "t-5", title: "ขอยศ" }, "เซิร์ฟทดสอบ");
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /ขอยศ/);
  assert.match(sent[0] ?? "", /เซิร์ฟทดสอบ/);

  await ticket.notifyTicketClosed(dmClient([], true), { subject_id: "t-5", title: "x" });
  const gone = {
    users: { fetch: async () => { throw new Error("Unknown User"); } },
  } as unknown as Client;
  await ticket.notifyTicketClosed(gone, { subject_id: "t-6", title: "x" });
});
