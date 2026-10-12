/**
 * warnMember ขั้น 'ban' + banRequiresApproval
 * เปิด = ไม่แบนเอง แต่ส่งเข้าคิว "รอยืนยันแบน" · ปิด = แบนทันทีแบบเดิม
 * ใช้ mock GuildMember (ไม่ต่อ Discord) และ DB ชั่วคราวใน tmp
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuildMember } from "discord.js";

const DB_PATH = join(tmpdir(), "bot-test-warnaction-queue.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

type Warn = typeof import("../src/modules/warnAction.js");
type Store = typeof import("../src/store/queueStore.js");
type Config = typeof import("../src/config.js")["config"];
let warnMember: Warn["warnMember"];
let store: Store;
let config: Config;
let BAN_AT: number;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  ({ config } = await import("../src/config.js"));
  ({ warnMember } = await import("../src/modules/warnAction.js"));
  store = await import("../src/store/queueStore.js");
  // เทสเฉพาะขั้นแบน — ตัดขั้นอื่นทิ้ง จะได้ไม่ต้อง mock ไมค์แดง/timeout
  config.warnings.escalation = [{ count: 2, action: "ban" }];
  BAN_AT = 2;
});

let banned: string[];
let dms: string[];
beforeEach(() => {
  banned = [];
  dms = [];
});

function mockMember(id: string): GuildMember {
  return {
    id,
    guild: { id: "guild-1", name: "เซิร์ฟทดสอบ" },
    user: { tag: `user${id}` },
    voice: { channel: null },
    send: async (text: string) => void dms.push(text),
    ban: async () => void banned.push(id),
  } as unknown as GuildMember;
}

async function warnUntilBan(id: string, lastReason: string) {
  const m = mockMember(id);
  for (let i = 1; i < BAN_AT; i++) await warnMember(m, "mod-1", "mod#1", "เหตุผลเก่า");
  return warnMember(m, "mod-1", "mod#1", lastReason);
}

test("banRequiresApproval เปิด → ไม่แบน แต่เข้าคิว ban-approval พร้อมจำนวนเตือน + เหตุผลล่าสุด", async () => {
  config.warnings.banRequiresApproval = true;
  const r = await warnUntilBan("w-1", "สแปมลิงก์");

  assert.deepEqual(banned, [], "ต้องยังไม่แบน");
  const row = store.listOpen("ban-approval").find((x) => x.subject_id === "w-1");
  assert.ok(row, "ต้องมีเรื่องค้างในคิว");
  assert.equal(row.title, "userw-1");
  assert.equal(row.detail, `เตือนครบ ${BAN_AT} ครั้ง — ล่าสุด: สแปมลิงก์`);

  assert.equal(r.level, "alert");
  assert.match(r.actionMsg, /รอ mod ยืนยัน/);
  assert.match(dms.at(-1) ?? "", /รอผู้ดูแลพิจารณา/, "DM ต้องไม่บอกว่าโดนแบนแล้ว");
});

test("banRequiresApproval ปิด → แบนทันทีแบบเดิม ไม่เข้าคิว", async () => {
  config.warnings.banRequiresApproval = false;
  const r = await warnUntilBan("w-2", "ด่า");

  assert.deepEqual(banned, ["w-2"]);
  assert.equal(
    store.listOpen("ban-approval").find((x) => x.subject_id === "w-2"),
    undefined,
  );
  assert.match(r.actionMsg, /ลงโทษ: แบน/);
});

test("ค่าเริ่มต้นใน config คือรอ mod ยืนยัน และตั้งจากหน้าตั้งค่าได้", async () => {
  const { SECTIONS } = await import("../src/store/settingsStore.js");
  const keys = SECTIONS.flatMap((s) => s.items.map((i) => i.key));
  assert.ok(keys.includes("warnings.banRequiresApproval"));
  // อ่านค่าเริ่มต้นจากไฟล์ config โดยตรง — object config ในเทสนี้ถูกแก้ไปแล้ว
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
  assert.match(src, /banRequiresApproval:\s*true/);
});
