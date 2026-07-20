/**
 * ทดสอบ #5 — anti-raid ต้องจัดการผู้เข้าใหม่ "ทั้ง batch" ไม่ใช่แค่คนเดียว
 * ใช้ mock GuildMember (ไม่ต่อ Discord) — logChannelId ว่าง จึงไม่แตะ client จริง
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuildMember } from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-antiraid.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

let handleMemberJoin: (m: GuildMember) => Promise<void>;
let THRESHOLD: number;
const kicked = new Set<string>();
const banned = new Set<string>();

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.antiRaid.action = "kick";
  THRESHOLD = config.antiRaid.joinThreshold;
  ({ handleMemberJoin } = await import("../src/modules/antiRaid.js"));
});

function mockMember(
  id: string,
  ageDays: number,
  opts: { exempt?: boolean } = {},
): GuildMember {
  return {
    id,
    guild: { id: "guild-1" },
    client: {},
    user: {
      bot: false,
      tag: `user${id}#0001`,
      createdTimestamp: Date.now() - ageDays * 24 * 60 * 60 * 1000,
    },
    // isExempt() เรียก roles.cache.some และ permissions.has
    roles: { cache: { some: () => false } },
    permissions: { has: () => opts.exempt === true },
    kick: async () => void kicked.add(id),
    ban: async () => void banned.add(id),
  } as unknown as GuildMember;
}

test("เข้า account ใหม่ครบ threshold → ถูก kick ทั้ง batch (ไม่ใช่แค่ 1)", async () => {
  for (let i = 1; i <= THRESHOLD; i++) await handleMemberJoin(mockMember(`new-${i}`, 0));
  assert.equal(kicked.size, THRESHOLD);
});

test("account ใหม่ที่เข้าระหว่าง raid → ถูก kick ต่อเนื่อง", async () => {
  await handleMemberJoin(mockMember("new-late", 0));
  assert.ok(kicked.has("new-late"));
});

test("account เก่าเข้าช่วง raid → ไม่ถูกแตะ (กันกระทบสมาชิกจริง)", async () => {
  await handleMemberJoin(mockMember("old-1", 30));
  assert.ok(!kicked.has("old-1"));
});

test("account ยกเว้น (mod) แม้ใหม่ ก็ไม่ถูก kick ตอน raid", async () => {
  await handleMemberJoin(mockMember("mod-young", 0, { exempt: true }));
  assert.ok(!kicked.has("mod-young"));
});

test("โหมด kick ไม่มีการ ban", () => {
  assert.equal(banned.size, 0);
});
