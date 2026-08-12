/**
 * ทดสอบ oledConfig — ตัวกลางระหว่างหน้าเว็บแอดมินกับสคริปต์จอ OLED (Python)
 * ใช้ไฟล์ชั่วคราวใน tmp (OLED_CONFIG_PATH) ไม่แตะไฟล์ตั้งค่าตัวจริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ต้องตั้ง env ก่อน import โมดูล (อ่าน OLED_CONFIG_PATH ตอนโหลด)
const PATH = join(mkdtempSync(join(tmpdir(), "oled-")), "oled.json");
process.env.OLED_CONFIG_PATH = PATH;

const { getOledConfig, setOledConfig, isOledPage, OLED_PAGES } = await import(
  "../src/utils/oledConfig.js"
);

test("ไฟล์ยังไม่มี = คืนหน้าเริ่มต้น ไม่โยน error", () => {
  assert.equal(getOledConfig().page, "LOAD");
});

test("เลือกหน้าแล้วอ่านกลับได้หน้าเดิม", () => {
  assert.equal(setOledConfig("NET").page, "NET");
  assert.equal(getOledConfig().page, "NET");
});

test("ในไฟล์เก็บเป็น key ชื่อ page ตัวพิมพ์ใหญ่ ให้ฝั่ง Python อ่านตรง ๆ", () => {
  setOledConfig("therm");
  assert.deepEqual(JSON.parse(readFileSync(PATH, "utf8")), { page: "THERM" });
});

test("รับตัวพิมพ์เล็กได้ แต่เก็บเป็นพิมพ์ใหญ่เสมอ", () => {
  assert.equal(setOledConfig("load").page, "LOAD");
});

test("ชื่อหน้าที่ไม่มีจริง = โยน error ไม่เขียนทับของเดิม", () => {
  setOledConfig("NET");
  assert.throws(() => setOledConfig("ไม่มีหน้านี้"));
  assert.equal(getOledConfig().page, "NET");
});

test("ไฟล์พัง = คืนค่าเริ่มต้น ไม่ทำให้หน้าตั้งค่าล่ม", () => {
  writeFileSync(PATH, "{ นี่ไม่ใช่ json");
  assert.equal(getOledConfig().page, "LOAD");
});

test("ค่าในไฟล์เป็นหน้าที่ไม่รู้จัก (แก้มือมา) = กลับไปใช้ค่าเริ่มต้น", () => {
  writeFileSync(PATH, JSON.stringify({ page: "BANANA" }));
  assert.equal(getOledConfig().page, "LOAD");
});

test("ไฟล์รูปแบบเก่าที่มีแต่ page_seconds = ไม่พัง แค่กลับไปใช้ค่าเริ่มต้น", () => {
  writeFileSync(PATH, JSON.stringify({ page_seconds: 5 }));
  assert.equal(getOledConfig().page, "LOAD");
});

test("เลือกหน้าเดิมซ้ำก็ยังเขียนไฟล์ — mtime คือสัญญาณเดียวที่ฝั่ง Python ดู", async () => {
  setOledConfig("NET");
  const before = statSync(PATH).mtimeMs;
  await new Promise((r) => setTimeout(r, 12)); // ให้ mtime ขยับได้จริง
  setOledConfig("NET");
  assert.notEqual(statSync(PATH).mtimeMs, before);
});

test("isOledPage คัดของแปลกปลอมออก", () => {
  assert.equal(isOledPage("LOAD"), true);
  assert.equal(isOledPage("net"), true);
  assert.equal(isOledPage("BANANA"), false);
  assert.equal(isOledPage(undefined), false);
  assert.equal(isOledPage(42), false);
});

// หมายเหตุ: ยันได้แค่ฝั่งนี้ ตัว stats_beautiful.py อยู่นอก repo เลย import มาเทียบไม่ได้
// ถ้าแก้ PAGES ฝั่งโน้นต้องมาแก้ตรงนี้ด้วย เทสต์นี้ทำหน้าที่เตือนว่ามีคู่ที่ต้องแก้พร้อมกัน
test("รายชื่อหน้าเป็นชุดที่ตกลงกับสคริปต์จอไว้", () => {
  assert.deepEqual([...OLED_PAGES], ["LOAD", "THERM", "NET"]);
});
