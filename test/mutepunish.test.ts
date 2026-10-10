/**
 * ทดสอบระบบลงโทษ "ไมค์แดง" (server mute) ของระบบเตือน:
 *  - mutePunishmentStore: บันทึก/อ่านที่ยังไม่หมด/ที่หมดแล้ว/ล้าง
 *  - enforceMute: มีคนปลด/เพิ่งเข้าห้อง → ปิดกลับ, ไม่มีโทษ/ปิดอยู่แล้ว → ไม่ทำอะไร
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botmute-")), "test.db");

const store = await import("../src/modules/mutePunishmentStore.js");
const { enforceMute } = await import("../src/modules/muteEnforce.js");

const GUILD = "g1";

/* ---------- store ---------- */

test("store: บันทึกแล้วอ่านเป็น active ตอนยังไม่หมดเวลา", () => {
  store.setMutePunishment({
    userId: "u1",
    guildId: GUILD,
    until: Date.now() + 60_000,
    reason: "เตือนครบ 3 ครั้ง",
  });
  const p = store.getActiveMute("u1");
  assert.ok(p, "ต้องเจอโทษที่ยังไม่หมด");
  assert.equal(p?.reason, "เตือนครบ 3 ครั้ง");
});

test("store: หมดเวลาแล้วไม่นับเป็น active + โผล่ในรายการ expired", () => {
  store.setMutePunishment({
    userId: "u2",
    guildId: GUILD,
    until: Date.now() - 1000, // หมดไปแล้ว
    reason: "เก่า",
  });
  assert.equal(store.getActiveMute("u2"), null, "หมดเวลาแล้วไม่ควร active");
  assert.ok(
    store.listExpiredMutes().some((p) => p.userId === "u2"),
    "ต้องอยู่ในรายการรอปลด",
  );
});

test("store: clear แล้วหายไปจริง", () => {
  store.clearMutePunishment("u1");
  store.clearMutePunishment("u2");
  assert.equal(store.getActiveMute("u1"), null);
});

/* ---------- enforceMute ---------- */

// สร้าง VoiceState ปลอมเท่าที่ enforceMute ใช้จริง
function fakeState(opts: {
  userId: string;
  inChannel: boolean;
  serverMute: boolean;
  onSetMute?: (v: boolean) => void;
}) {
  return {
    serverMute: opts.serverMute,
    channel: opts.inChannel ? { id: "vc1" } : null,
    member: opts.inChannel
      ? {
          id: opts.userId,
          user: { tag: `${opts.userId}#0` },
          client: {} as never,
          voice: {
            async setMute(v: boolean) {
              opts.onSetMute?.(v);
            },
          },
        }
      : null,
  } as never;
}

test("enforceMute: คนโดนโทษถูกปลด (แดง→ปกติ) → สั่งปิดกลับ", async () => {
  store.setMutePunishment({
    userId: "m1",
    guildId: GUILD,
    until: Date.now() + 60_000,
    reason: "โทษ",
  });
  let muted: boolean | null = null;
  const oldS = fakeState({ userId: "m1", inChannel: true, serverMute: true });
  const newS = fakeState({
    userId: "m1",
    inChannel: true,
    serverMute: false,
    onSetMute: (v) => (muted = v),
  });
  await enforceMute(oldS, newS);
  assert.equal(muted, true, "ต้องสั่ง setMute(true) ปิดกลับ");
  store.clearMutePunishment("m1");
});

test("enforceMute: ไม่มีโทษ → ไม่แตะอะไร", async () => {
  let called = false;
  const oldS = fakeState({ userId: "m2", inChannel: true, serverMute: true });
  const newS = fakeState({
    userId: "m2",
    inChannel: true,
    serverMute: false,
    onSetMute: () => (called = true),
  });
  await enforceMute(oldS, newS);
  assert.equal(called, false, "คนไม่โดนโทษต้องไม่ถูกปิดไมค์");
});

test("enforceMute: ถูกปิดไมค์อยู่แล้ว → ไม่เรียกซ้ำ (กันลูป)", async () => {
  store.setMutePunishment({
    userId: "m3",
    guildId: GUILD,
    until: Date.now() + 60_000,
    reason: "โทษ",
  });
  let called = false;
  const oldS = fakeState({ userId: "m3", inChannel: true, serverMute: false });
  const newS = fakeState({
    userId: "m3",
    inChannel: true,
    serverMute: true, // แดงอยู่แล้ว
    onSetMute: () => (called = true),
  });
  await enforceMute(oldS, newS);
  assert.equal(called, false, "แดงอยู่แล้วต้องไม่สั่ง setMute ซ้ำ");
  store.clearMutePunishment("m3");
});
