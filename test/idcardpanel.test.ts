/**
 * ทดสอบพาเนลบัตรประจำตัว (ที่ /setup-idcard วางไว้ในห้อง)
 *
 * จุดสำคัญคือแบนเนอร์ต้องแนบไปกับข้อความ ไม่ใช่อ้าง URL ของ Discord CDN
 * เพราะลิงก์พวกนั้นเซ็นมาพร้อมวันหมดอายุ พาเนลที่ปักไว้จะรูปแตกเงียบ ๆ
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db (db.ts อ่าน BOT_DB_PATH ตอนโหลด)
const DB_PATH = join(tmpdir(), "bot-test-panel.db");
process.env.BOT_DB_PATH = DB_PATH;

const ASSET = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "idcard",
  "assets",
  "panel_banner.jpg",
);

let buildPanel: typeof import("../src/idcard/idcardSetup.js").buildPanel;
let PANEL_BANNER_NAME: string;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  ({ buildPanel, PANEL_BANNER_NAME } = await import(
    "../src/idcard/idcardSetup.js"
  ));
});

test("ไฟล์แบนเนอร์มีอยู่จริง — ถ้าหายไปพาเนลจะส่งไม่ออกตอนรันจริง", () => {
  assert.ok(existsSync(ASSET), `ไม่เจอ ${ASSET}`);
  assert.ok(statSync(ASSET).size > 0);
});

test("พาเนลแนบไฟล์แบนเนอร์ไปด้วย", () => {
  const panel = buildPanel();
  assert.equal(panel.files.length, 1);
  assert.equal(panel.files[0]?.name, PANEL_BANNER_NAME);
});

test("embed ชี้รูปด้วย attachment:// ไม่ใช่ URL ภายนอกที่หมดอายุได้", () => {
  const url = buildPanel().embeds[0]?.toJSON().image?.url;
  assert.equal(url, `attachment://${PANEL_BANNER_NAME}`);
  assert.doesNotMatch(String(url), /^https?:/);
});

test("ปุ่มสร้างบัตรยังอยู่ครบ ไม่ได้หลุดไปตอนใส่รูป", () => {
  const row = buildPanel().components[0]?.toJSON() as {
    components: { custom_id?: string }[];
  };
  assert.equal(row.components.length, 1);
  assert.equal(row.components[0]?.custom_id, "idcard_create");
});
