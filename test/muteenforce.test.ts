/**
 * ไมค์แดงจากระบบเตือน — ครบเวลาตอนอยู่นอกห้องต้องไม่ค้างแดงถาวร และปุ่มปลดทันทีต้องปลดได้จริง
 * Discord ปลด server mute ได้เฉพาะคนที่อยู่ในห้อง แต่ mute ติดตัวไปห้องถัดไป
 * ใช้ mock Guild/GuildMember/VoiceState (ไม่ต่อ Discord) และ DB ชั่วคราวใน tmp
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client, Guild, GuildMember, VoiceState } from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-muteenforce.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

type Enforce = typeof import("../src/modules/muteEnforce.js");
type Store = typeof import("../src/modules/mutePunishmentStore.js");
let enforce: Enforce;
let store: Store;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  enforce = await import("../src/modules/muteEnforce.js");
  store = await import("../src/modules/mutePunishmentStore.js");
});

const GUILD = "guild-1";

/** สมาชิกจำลอง — inVoice/serverMute เปลี่ยนได้ระหว่างเทส · setMute ทำงานเฉพาะตอนอยู่ในห้อง (เหมือน Discord) */
function mockMember(id: string, s: { inVoice: boolean; serverMute: boolean }) {
  const calls: boolean[] = [];
  const member = {
    id,
    client: {},
    user: { tag: `user${id}` },
    voice: {
      get channel() {
        return s.inVoice ? { id: "vc-1" } : null;
      },
      get serverMute() {
        return s.serverMute;
      },
      setMute: async (mute: boolean) => {
        if (!s.inVoice) throw new Error("Target user is not connected to voice.");
        calls.push(mute);
        s.serverMute = mute;
      },
    },
  } as unknown as GuildMember;
  return { member, calls, s };
}

function mockGuild(members: GuildMember[]) {
  const guild = {
    id: GUILD,
    members: {
      fetch: async (id: string) => {
        const m = members.find((x) => x.id === id);
        if (!m) throw new Error("Unknown Member");
        return m;
      },
    },
  } as unknown as Guild;
  const client = { guilds: { cache: { get: () => guild } } } as unknown as Client;
  return { guild, client };
}

/** voiceStateUpdate ตอนเข้าห้อง (old ไม่อยู่ห้อง → new อยู่ห้อง) */
function joinState(member: GuildMember, serverMute: boolean) {
  const oldState = { channel: null, serverMute } as unknown as VoiceState;
  const newState = { member, channel: { id: "vc-1" }, serverMute } as unknown as VoiceState;
  return [oldState, newState] as const;
}

const expired = (userId: string) =>
  store.setMutePunishment({ userId, guildId: GUILD, until: Date.now() - 1000, reason: "เตือนครบ 3 ครั้ง" });
const active = (userId: string) =>
  store.setMutePunishment({ userId, guildId: GUILD, until: Date.now() + 3_600_000, reason: "เตือนครบ 3 ครั้ง" });

test("ครบเวลาตอนอยู่ในห้อง → ปลดเลย ไม่ค้าง", async () => {
  const m = mockMember("in-1", { inVoice: true, serverMute: true });
  const { client } = mockGuild([m.member]);
  expired("in-1");
  await enforce.releaseExpiredMutes(client);
  assert.deepEqual(m.calls, [false]);
  assert.equal(store.getReleasePending("in-1"), null);
});

test("ครบเวลาตอนอยู่นอกห้อง → จดค้างปลด แล้วปลดทันทีที่กลับเข้าห้อง", async () => {
  const m = mockMember("out-1", { inVoice: false, serverMute: true });
  const { client } = mockGuild([m.member]);
  expired("out-1");
  await enforce.releaseExpiredMutes(client);
  assert.ok(store.getReleasePending("out-1"), "ต้องจดไว้ว่ายังค้างปลด");
  assert.equal(store.listExpiredMutes().some((p) => p.userId === "out-1"), false, "ลูปต้องไม่วนเจอซ้ำ");

  m.s.inVoice = true; // กลับเข้าห้อง — mute ยังติดตัวมา
  await enforce.enforceMute(...joinState(m.member, true));
  assert.deepEqual(m.calls, [false]);
  assert.equal(store.getReleasePending("out-1"), null);
});

test("ค้างปลดอยู่ แต่โดนโทษรอบใหม่แล้ว → เข้าห้องต้องแดงต่อ ไม่ปลดตามรายการเก่า", async () => {
  const m = mockMember("again-1", { inVoice: true, serverMute: true });
  store.markReleasePending("again-1", GUILD, "รอบเก่า");
  active("again-1");
  await enforce.enforceMute(...joinState(m.member, true));
  assert.deepEqual(m.calls, []);
  store.clearMutePunishment("again-1");
});

test("ปลดทันที (อยู่ในห้อง) → ปลด + ยกเลิกโทษ และ enforceMute ไม่ปิดกลับ", async () => {
  const m = mockMember("now-1", { inVoice: true, serverMute: true });
  const { guild } = mockGuild([m.member]);
  active("now-1");
  assert.equal(await enforce.releaseMuteNow(guild, "now-1"), "unmuted");
  assert.deepEqual(m.calls, [false]);
  assert.equal(store.getActiveMute("now-1"), null);

  // ย้ายห้อง/อัปเดตสถานะหลังปลด — ต้องไม่ถูกปิดกลับ
  await enforce.enforceMute(...joinState(m.member, false));
  assert.deepEqual(m.calls, [false]);
});

test("ปลดทันที (อยู่นอกห้อง) → ยกเลิกโทษ แล้วปลดให้ตอนเข้าห้อง", async () => {
  const m = mockMember("now-2", { inVoice: false, serverMute: true });
  const { guild } = mockGuild([m.member]);
  active("now-2");
  assert.equal(await enforce.releaseMuteNow(guild, "now-2"), "pending");
  assert.equal(store.getActiveMute("now-2"), null);

  m.s.inVoice = true;
  await enforce.enforceMute(...joinState(m.member, true));
  assert.deepEqual(m.calls, [false]);
});

test("ปลดทันที: ไม่ได้โดนอะไรอยู่ / ไม่อยู่ในเซิร์ฟ", async () => {
  const m = mockMember("clean-1", { inVoice: true, serverMute: false });
  const { guild } = mockGuild([m.member]);
  assert.equal(await enforce.releaseMuteNow(guild, "clean-1"), "not-muted");
  assert.equal(await enforce.releaseMuteNow(guild, "ghost"), "not-found");
  assert.deepEqual(m.calls, []);
});

test("บอทบูต: คนที่ค้างปลดและอยู่ในห้องแดงอยู่ → ปลดให้เลย", async () => {
  const m = mockMember("boot-1", { inVoice: true, serverMute: true });
  const { guild } = mockGuild([m.member]);
  store.markReleasePending("boot-1", GUILD, "เตือนครบ 3 ครั้ง");
  await enforce.seedMuteEnforcement(guild);
  assert.deepEqual(m.calls, [false]);
  assert.equal(store.getReleasePending("boot-1"), null);
});

test("โดนไมค์แดงรอบใหม่ → รายการค้างปลดของรอบก่อนถูกลบ", () => {
  store.markReleasePending("redo-1", GUILD, "รอบเก่า");
  active("redo-1");
  assert.equal(store.getReleasePending("redo-1"), null);
});
