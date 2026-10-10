/**
 * ทดสอบ relay ข้อความตอบกลับใน DM → log:
 *  - คนที่มีเตือน (เพิ่งถูกเตือน) → relay ขึ้น log เป็น member_dm_reply
 *  - คนที่ไม่เคยโดนเตือน → ไม่ relay
 *  - ข้าม DM ที่มาจากบอท
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botdm-")), "test.db");

const { handleDmReply } = await import("../src/modules/dmRelay.js");
const { addWarning } = await import("../src/modules/warningStore.js");
const { getLogs } = await import("../src/store/logStore.js");

function dmReplies(userId: string): number {
  return getLogs({ events: ["member_dm_reply"], limit: 500 }).filter((l) =>
    l.fields.some((f) => f.value.includes(userId)),
  ).length;
}

function fakeDm(opts: { userId: string; bot?: boolean; content?: string }) {
  return {
    partial: false,
    author: { bot: opts.bot ?? false, id: opts.userId, tag: `${opts.userId}#0` },
    content: opts.content ?? "ขอโทษครับ ผมผิดไปแล้ว",
    attachments: { values: () => [] as { url: string }[] },
    client: {} as never,
  } as never;
}

test("relay: คนที่เพิ่งถูกเตือน DM กลับมา → ขึ้น log", async () => {
  addWarning("warned1", "mod", "mod#0", "พูดจาไม่ดี");
  await handleDmReply(fakeDm({ userId: "warned1" }));
  assert.equal(dmReplies("warned1"), 1, "ต้อง relay ขึ้น log 1 รายการ");
});

test("relay: คนที่ไม่เคยโดนเตือน → ไม่ relay", async () => {
  await handleDmReply(fakeDm({ userId: "stranger1" }));
  assert.equal(dmReplies("stranger1"), 0, "คนไม่มีเตือนต้องไม่ถูก relay");
});

test("relay: ข้าม DM ที่มาจากบอท", async () => {
  addWarning("botuser", "mod", "mod#0", "x");
  await handleDmReply(fakeDm({ userId: "botuser", bot: true }));
  assert.equal(dmReplies("botuser"), 0, "DM จากบอทต้องไม่ถูก relay");
});
