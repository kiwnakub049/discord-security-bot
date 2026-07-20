/**
 * ทดสอบ backend ระบบ activity / XP — level formula, message cooldown,
 * voice-time accumulation (รวม transition-based tracker)
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VoiceState } from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-activity.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

type Store = typeof import("../src/store/activityStore.js");
type VoiceMod = typeof import("../src/modules/voiceActivity.js");
let S: Store;
let V: VoiceMod;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  S = await import("../src/store/activityStore.js");
  V = await import("../src/modules/voiceActivity.js");
});

test("xpForLevel: XP สะสมต่อเลเวลถูกต้อง", () => {
  assert.equal(S.xpForLevel(1), 0);
  assert.equal(S.xpForLevel(2), 100);
  assert.equal(S.xpForLevel(3), 300);
  assert.equal(S.xpForLevel(4), 600);
  assert.equal(S.xpForLevel(5), 1000);
});

test("levelFromXp: แปลง XP → เลเวล ถูกต้องตรงขอบ", () => {
  assert.equal(S.levelFromXp(0), 1);
  assert.equal(S.levelFromXp(99), 1);
  assert.equal(S.levelFromXp(100), 2);
  assert.equal(S.levelFromXp(299), 2);
  assert.equal(S.levelFromXp(300), 3);
  assert.equal(S.levelFromXp(1000), 5);
});

test("levelProgress: คำนวณ % ในเลเวลปัจจุบัน", () => {
  const p = S.levelProgress(150); // อยู่ L2 (100–300), เข้าไป 50 จาก 200
  assert.equal(p.level, 2);
  assert.equal(p.xpIntoLevel, 50);
  assert.equal(p.xpForNext, 200);
  assert.equal(p.pct, 25);
});

test("recordMessage: ให้ XP ครั้งแรก, cooldown กันครั้งถัดไป, พ้น cooldown ได้อีก", () => {
  assert.equal(S.recordMessage("m1", 1000).awardedXp, 10); // ได้ XP
  assert.equal(S.recordMessage("m1", 1000 + 59_999).awardedXp, 0); // ยังไม่พ้น 60s
  assert.equal(S.recordMessage("m1", 1000 + 60_000).awardedXp, 10); // พ้นแล้ว
  const a = S.getActivity("m1");
  assert.equal(a.messages, 3); // นับข้อความทุกครั้ง
  assert.equal(a.xp, 20); // ได้ XP 2 ครั้ง × 10
});

test("addVoiceTime: 120 วิ → 120s + XP 10 (5/นาที)", () => {
  const r = S.addVoiceTime("v1", 120);
  assert.equal(r.awardedXp, 10);
  const a = S.getActivity("v1");
  assert.equal(a.voiceSeconds, 120);
  assert.equal(a.xp, 10);
});

test("level-up detection: ข้ามขอบเลเวล → leveledUp=true", () => {
  // lvlup ต้องมี XP ทะลุ 100 (L1→L2). ให้เวลาห้องเสียงก้อนใหญ่: 1200s = 100 XP
  const r = S.addVoiceTime("lvl1", 1200);
  assert.equal(r.awardedXp, 100);
  assert.equal(r.oldLevel, 1);
  assert.equal(r.newLevel, 2);
  assert.equal(r.leveledUp, true);
  // ครั้งถัดไปยังไม่ข้ามขอบ → false
  assert.equal(S.addVoiceTime("lvl1", 60).leveledUp, false);
});

test("topByXp: เรียงจากมากไปน้อย", () => {
  const top = S.topByXp(50);
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1].xp >= top[i].xp, "ต้องเรียง XP มาก→น้อย");
  }
});

// ---- transition-based voice tracker ----
function mockVoice(
  id: string,
  channelId: string | null,
  opts: { mute?: boolean; bot?: boolean } = {},
): VoiceState {
  return {
    id,
    channelId,
    guild: { afkChannelId: "afk-channel" },
    selfMute: opts.mute ?? false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    member: { user: { bot: opts.bot ?? false } },
  } as unknown as VoiceState;
}

test("tracker: เข้า→ออก 60 วิ → นับ 60s + XP 5", () => {
  V._resetVoiceActivity();
  const t0 = 1_000_000;
  V.trackVoiceActivity(mockVoice("u1", null), mockVoice("u1", "room1"), t0); // เข้า
  V.trackVoiceActivity(mockVoice("u1", "room1"), mockVoice("u1", null), t0 + 60_000); // ออก
  const a = S.getActivity("u1");
  assert.equal(a.voiceSeconds, 60);
  assert.equal(a.xp, 5);
});

test("tracker: ปิดไมค์แล้วไม่นับเวลาช่วงที่ mute", () => {
  V._resetVoiceActivity();
  const t0 = 2_000_000;
  V.trackVoiceActivity(mockVoice("u2", null), mockVoice("u2", "room1"), t0); // เข้า (นับ)
  V.trackVoiceActivity(mockVoice("u2", "room1"), mockVoice("u2", "room1", { mute: true }), t0 + 30_000); // ปิดไมค์ → flush 30s, หยุดนับ
  V.trackVoiceActivity(mockVoice("u2", "room1", { mute: true }), mockVoice("u2", null), t0 + 90_000); // ออก (ไม่มีอะไรค้าง)
  const a = S.getActivity("u2");
  assert.equal(a.voiceSeconds, 30); // นับแค่ 30s แรก
});

test("tracker: ข้ามบอท", () => {
  V._resetVoiceActivity();
  const t0 = 3_000_000;
  V.trackVoiceActivity(mockVoice("bot1", null, { bot: true }), mockVoice("bot1", "room1", { bot: true }), t0);
  V.trackVoiceActivity(mockVoice("bot1", "room1", { bot: true }), mockVoice("bot1", null, { bot: true }), t0 + 60_000);
  assert.equal(S.getActivity("bot1").voiceSeconds, 0);
});
