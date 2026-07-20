/**
 * ทดสอบ settingsStore — coerce ชนิดใหม่ (id / list / idlist) + persistence ผ่าน applyOverrides
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db (db.ts อ่าน BOT_DB_PATH ตอนโหลด)
process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botset-")), "test.db");

const S = await import("../src/store/settingsStore.js");
const { config } = await import("../src/config.js");

test("list: แปลง string คั่นด้วย , หรือขึ้นบรรทัดใหม่ เป็น array (trim + ตัดค่าว่าง)", () => {
  S.updateSettings({ "autoMod.bannedWords": " คำหยาบ, spam \nscam ,, " });
  assert.deepEqual(config.autoMod.bannedWords, ["คำหยาบ", "spam", "scam"]);
});

test("id: รับเฉพาะตัวเลขล้วนหรือว่าง — ค่าเพี้ยนให้คงค่าเดิม", () => {
  S.updateSettings({ logChannelId: "1234567890" });
  assert.equal(config.logChannelId, "1234567890");
  S.updateSettings({ logChannelId: "abc<script>" });
  assert.equal(config.logChannelId, "1234567890"); // ไม่ใช่ตัวเลข → คงเดิม
  S.updateSettings({ logChannelId: "" });
  assert.equal(config.logChannelId, ""); // ว่าง = ปิดฟีเจอร์ได้
});

test("idlist: ตัดค่าที่ไม่ใช่ตัวเลขทิ้ง", () => {
  S.updateSettings({ exemptUserIds: "111, abc, 222\n<img>" });
  assert.deepEqual(config.exemptUserIds, ["111", "222"]);
});

test("persistence: applyOverrides โหลดค่า list กลับจาก DB ได้ถูกต้อง", () => {
  S.updateSettings({ "autoMod.bannedWords": "x, y" });
  (config.autoMod.bannedWords as string[]) = []; // ทำเหมือน restart แล้วค่าหาย
  S.applyOverrides();
  assert.deepEqual(config.autoMod.bannedWords, ["x", "y"]);
});

test("key ที่ไม่อยู่ใน SECTIONS ถูกเมิน (กันยัด key แปลกจาก request)", () => {
  S.updateSettings({ "web.trustProxy": true, "__proto__.x": 1 });
  assert.equal(config.web.trustProxy, 1);
});
