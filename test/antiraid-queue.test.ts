/**
 * anti-raid → คิว "สมาชิกใหม่น่าสงสัย"
 * ช่วงปกติต้องส่ง account ใหม่เข้าคิว ช่วง raid ต้องไม่ส่ง และเรื่องค้างต้องปิดเองเมื่อคนนั้นไม่อยู่แล้ว
 * ใช้ mock GuildMember แบบเดียวกับ antiraid.test.ts — แต่ละเทสใช้ guild id ของตัวเอง
 * เพราะหน้าต่างนับคนเข้า (recentJoins) แยกต่อ guild ไม่งั้นเทสจะนับคนของกันและกันจนเป็น raid
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuildMember } from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-antiraid-queue.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

type AntiRaid = typeof import("../src/modules/antiRaid.js");
type Store = typeof import("../src/store/queueStore.js");
let antiRaid: AntiRaid;
let store: Store;
let THRESHOLD: number;
const kicked = new Set<string>();

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.antiRaid.action = "kick";
  THRESHOLD = config.antiRaid.joinThreshold;
  antiRaid = await import("../src/modules/antiRaid.js");
  store = await import("../src/store/queueStore.js");
});

function mockMember(
  id: string,
  guildId: string,
  ageDays: number,
  opts: { exempt?: boolean } = {},
): GuildMember {
  return {
    id,
    guild: { id: guildId },
    client: {},
    user: {
      bot: false,
      tag: `user${id}`,
      createdTimestamp: Date.now() - ageDays * 24 * 60 * 60 * 1000,
    },
    roles: { cache: { some: () => false } },
    permissions: { has: () => opts.exempt === true },
    kick: async () => void kicked.add(id),
    ban: async () => {},
  } as unknown as GuildMember;
}

const openFor = (id: string) =>
  store.listOpen("suspicious-member").find((r) => r.subject_id === id);

test("account ใหม่เข้าช่วงปกติ → เข้าคิว พร้อมชื่อและอายุบัญชี", async () => {
  await antiRaid.handleMemberJoin(mockMember("s-new", "g-normal", 2));
  const row = openFor("s-new");
  assert.ok(row, "ต้องมีเรื่องค้างในคิว");
  assert.equal(row.title, "users-new");
  assert.match(row.detail ?? "", /อายุบัญชี 2 วัน/);
  assert.doesNotMatch(row.detail ?? "", /พร้อมกัน/, "เข้าคนเดียวไม่ต้องบอกจำนวน");
});

test("account เก่า / account ยกเว้น → ไม่เข้าคิว", async () => {
  await antiRaid.handleMemberJoin(mockMember("s-old", "g-skip", 300));
  await antiRaid.handleMemberJoin(mockMember("s-mod", "g-skip2", 0, { exempt: true }));
  assert.equal(openFor("s-old"), undefined);
  assert.equal(openFor("s-mod"), undefined);
});

test("เข้ามาพร้อมกันหลายคน → detail บอกจำนวนคน", async () => {
  await antiRaid.handleMemberJoin(mockMember("s-a", "g-pair", 0));
  await antiRaid.handleMemberJoin(mockMember("s-b", "g-pair", 0));
  assert.match(openFor("s-b")?.detail ?? "", /พร้อมกัน 2 คน/);
});

test("ออกจากเซิร์ฟก่อน mod ตัดสิน → ปิดเรื่องเป็น left โดย system", async () => {
  await antiRaid.handleMemberJoin(mockMember("s-leave", "g-leave", 1));
  const id = openFor("s-leave")?.id;
  assert.ok(id);
  antiRaid.closeSuspiciousOnLeave("s-leave");
  const row = store.getItem(id);
  assert.equal(row?.outcome, "left");
  assert.equal(row?.resolved_by, "system");
  // ออกซ้ำ / คนที่ไม่มีเรื่องค้าง ต้องไม่พัง
  antiRaid.closeSuspiciousOnLeave("s-leave");
  antiRaid.closeSuspiciousOnLeave("nobody");
});

test("raid: คนต้น batch ที่เข้าคิวไปแล้วถูกปิดด้วยผลจริง และคนที่เข้าระหว่าง raid ไม่เข้าคิว", async () => {
  const ids = Array.from({ length: THRESHOLD }, (_, i) => `r-${i}`);
  for (const id of ids) await antiRaid.handleMemberJoin(mockMember(id, "g-raid", 0));
  await antiRaid.handleMemberJoin(mockMember("r-late", "g-raid", 0));

  assert.ok(kicked.has("r-late"));
  for (const id of [...ids, "r-late"]) {
    assert.equal(openFor(id), undefined, `${id} ต้องไม่มีเรื่องค้าง`);
  }
  // คนแรกเข้าคิวตอนยังไม่เป็น raid → ต้องถูกปิดเป็น kick ไม่ใช่หายไปเฉย ๆ
  const { db } = await import("../src/store/db.js");
  const first = db
    .prepare("SELECT outcome, resolved_by FROM queue_items WHERE subject_id = ?")
    .get("r-0") as { outcome: string; resolved_by: string } | undefined;
  assert.deepEqual(first, { outcome: "kick", resolved_by: "system" });
});
