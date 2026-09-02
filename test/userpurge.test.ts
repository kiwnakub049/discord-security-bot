/**
 * ทดสอบการลบข้อมูลผู้ใช้เมื่อออกจากเซิร์ฟเวอร์ (purgeUserData)
 *  - ลบ member/warnings/activity/mute ครบ
 *  - ai_verdicts ลบเฉพาะเมื่อ purgeAiVerdicts = true
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botpurge-")), "test.db");

const { purgeUserData, purgedAnything, moderationHoldReason } = await import(
  "../src/modules/userPurge.js"
);
const { registerMember, getMember } = await import("../src/idcard/members.js");
const { addWarning, getWarnings } = await import("../src/modules/warningStore.js");
const { recordMessage, getActivity } = await import("../src/store/activityStore.js");
const { setMutePunishment, getActiveMute } = await import(
  "../src/modules/mutePunishmentStore.js"
);
const { db } = await import("../src/store/db.js");
const { config } = await import("../src/config.js");

function seed(userId: string) {
  registerMember(userId, null, "ไบแอส", "โสด");
  addWarning(userId, "mod", "mod#0", "เหตุผล");
  recordMessage(userId); // สร้างแถว activity + XP
  setMutePunishment({ userId, guildId: "g1", until: Date.now() + 60_000, reason: "x" });
  db.prepare(
    `INSERT INTO ai_verdicts (log_id, verdict, score, zone, text, user_id, decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(Math.floor(Math.random() * 1e9), "toxic", 0.9, "auto", "ข้อความ", userId, "mod", Date.now());
}

test("purge: ลบ member/warnings/activity/mute ครบ", () => {
  const u = "leave1";
  seed(u);
  const res = purgeUserData(u);
  assert.equal(res.member, true);
  assert.equal(res.warnings, 1);
  assert.equal(res.activity, true);
  assert.ok(purgedAnything(res));

  assert.equal(getMember(u), null, "บัตรต้องหาย");
  assert.equal(getWarnings(u).length, 0, "เตือนต้องหาย");
  assert.equal(getActivity(u).xp, 0, "XP ต้องรีเซ็ต (ไม่มีแถว)");
  assert.equal(getActiveMute(u), null, "โทษไมค์แดงต้องหาย");
});

test("purge: ค่าเริ่มต้นไม่ลบ ai_verdicts (เก็บเป็นข้อมูลเทรน)", () => {
  const u = "leave2";
  seed(u);
  const res = purgeUserData(u);
  assert.equal(res.verdicts, 0, "ไม่ควรลบ verdict");
  const left = db
    .prepare("SELECT COUNT(*) AS n FROM ai_verdicts WHERE user_id = ?")
    .get(u) as { n: number };
  assert.equal(left.n, 1, "verdict ต้องยังอยู่");
});

test("purge: purgeAiVerdicts = true → ลบ verdict ด้วย", () => {
  const u = "leave3";
  seed(u);
  const orig = config.privacy.purgeAiVerdicts;
  config.privacy.purgeAiVerdicts = true;
  try {
    const res = purgeUserData(u);
    assert.equal(res.verdicts, 1, "ต้องลบ verdict 1 แถว");
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM ai_verdicts WHERE user_id = ?")
      .get(u) as { n: number };
    assert.equal(left.n, 0);
  } finally {
    config.privacy.purgeAiVerdicts = orig;
  }
});

test("purge: คนที่ไม่มีข้อมูล → purgedAnything เป็น false", () => {
  const res = purgeUserData("nobody-here");
  assert.equal(purgedAnything(res), false);
});

/* ---------- เก็บข้อมูลถ้าถูกแอดมินจัดการ ---------- */

// guild ปลอม: ไม่แบน + ไม่มี kick ใน audit — ให้ผลตาม record ในเครื่องล้วน
function cleanGuild() {
  return {
    bans: { fetch: async () => { throw new Error("Unknown Ban"); } },
    fetchAuditLogs: async () => ({ entries: { find: () => undefined } }),
  } as never;
}

test("hold: มีประวัติเตือน → เก็บข้อมูลไว้ (ไม่ลบ)", async () => {
  const u = "mod-warned";
  addWarning(u, "mod", "mod#0", "x");
  assert.equal(await moderationHoldReason(cleanGuild(), u), "มีประวัติเตือน");
});

test("hold: กำลังโดนไมค์แดง → เก็บข้อมูลไว้", async () => {
  const u = "mod-muted";
  setMutePunishment({ userId: u, guildId: "g1", until: Date.now() + 60_000, reason: "x" });
  assert.equal(await moderationHoldReason(cleanGuild(), u), "กำลังโดนไมค์แดง");
});

test("hold: ถูกแบน → เก็บข้อมูลไว้", async () => {
  const banGuild = {
    bans: { fetch: async () => ({ user: { id: "x" } }) }, // เจอ ban
    fetchAuditLogs: async () => ({ entries: { find: () => undefined } }),
  } as never;
  assert.equal(await moderationHoldReason(banGuild, "banned-clean"), "ถูกแบน");
});

test("hold: เพิ่งถูกเตะ (kick) ใน audit → เก็บข้อมูลไว้", async () => {
  const kickGuild = {
    bans: { fetch: async () => { throw new Error("Unknown Ban"); } },
    fetchAuditLogs: async () => ({
      entries: {
        find: (fn: (e: { targetId: string; createdTimestamp: number }) => boolean) =>
          [{ targetId: "kicked-clean", createdTimestamp: Date.now() }].find(fn),
      },
    }),
  } as never;
  assert.equal(await moderationHoldReason(kickGuild, "kicked-clean"), "ถูกเตะ (kick)");
});

test("hold: ออกเองสะอาด ๆ (ไม่มี record/แบน/kick) → null = ลบได้", async () => {
  assert.equal(await moderationHoldReason(cleanGuild(), "clean-leaver"), null);
});
