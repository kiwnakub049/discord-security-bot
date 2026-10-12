/**
 * ขั้นลงโทษของระบบเตือน — ใช้ "ขั้นสูงสุดที่ถึงแล้ว" ไม่ใช่เฉพาะตอนจำนวนตรงเลขพอดี
 * (เดิมเตือนครั้งที่ 4, 6, 8+ ไม่มีโทษเลย)
 * ใช้ mock GuildMember (ไม่ต่อ Discord) และ DB ชั่วคราวใน tmp
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuildMember } from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-escalation.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

type Warn = typeof import("../src/modules/warnAction.js");
let warnMember: Warn["warnMember"];

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  // ค่าเดียวกับ config จริง (3 ไมค์แดง / 5 timeout / 7 แบน) — แบนทันทีเพื่อดูผลได้ตรง ๆ
  config.warnings.escalation = [
    { count: 3, action: "mute", ms: 60 * 60 * 1000 },
    { count: 5, action: "timeout", ms: 24 * 60 * 60 * 1000 },
    { count: 7, action: "ban" },
  ];
  config.warnings.banRequiresApproval = false;
  ({ warnMember } = await import("../src/modules/warnAction.js"));
});

test("เตือนครั้งที่ 1–9 ได้โทษตามขั้นสูงสุดที่ถึงแล้ว", async () => {
  const done: string[] = [];
  const member = {
    id: "esc-1",
    guild: { id: "guild-1", name: "เซิร์ฟทดสอบ" },
    user: { tag: "esc#1" },
    voice: { channel: null },
    send: async () => {},
    timeout: async () => void done.push("timeout"),
    ban: async () => void done.push("ban"),
  } as unknown as GuildMember;
  const { getActiveMute, clearMutePunishment } = await import("../src/modules/mutePunishmentStore.js");

  const got: string[] = [];
  for (let i = 1; i <= 9; i++) {
    done.length = 0;
    clearMutePunishment("esc-1");
    await warnMember(member, "mod-1", "mod#1", `ครั้งที่ ${i}`);
    got.push(getActiveMute("esc-1") ? "mute" : (done[0] ?? "-"));
  }
  assert.deepEqual(got, ["-", "-", "mute", "mute", "timeout", "timeout", "ban", "ban", "ban"]);
});
