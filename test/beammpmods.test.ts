/**
 * ทดสอบการรับไฟล์ม็อด
 *
 * ชื่อไฟล์มาจากเบราว์เซอร์ ถ้าเอาไปต่อ path ตรง ๆ จะเขียนไฟล์นอกโฟลเดอร์เกมได้
 * (เช่น ../../.ssh/authorized_keys) เทสชุดนี้จึงเน้นว่าชื่อแปลก ๆ ต้องถูกบีบให้อยู่ในกรอบ
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeModName } from "../src/beammp/mods.js";

test("ชื่อไฟล์ปกติผ่าน", () => {
  assert.equal(safeModName("drift_map.zip"), "drift_map.zip");
  assert.equal(safeModName("มอดรถไทย.zip"), "มอดรถไทย.zip");
  assert.equal(safeModName("Car Pack (v2).zip"), "Car Pack (v2).zip");
});

test("ชื่อไทยที่มีสระ/วรรณยุกต์ผ่าน", () => {
  /*
   * เคสจริงที่เคยพัง: regex เดิมใช้แค่ \p{L} ซึ่งไม่ครอบคลุมสระบน-ล่างและวรรณยุกต์
   * (Unicode category Mark) ทำให้ชื่อไทยส่วนใหญ่ถูกปฏิเสธ ทั้งที่ปลอดภัยดี
   */
  assert.equal(safeModName("แผนที่.zip"), "แผนที่.zip");
  assert.equal(safeModName("รถซิ่งใหม่ ๆ.zip"), "รถซิ่งใหม่ ๆ.zip");
  assert.equal(safeModName("สนามแข่งอันดาวน์ v2.zip"), "สนามแข่งอันดาวน์ v2.zip");
});

test("path ถูกตัดเหลือแค่ชื่อไฟล์ ไม่หลุดออกนอกโฟลเดอร์", () => {
  assert.equal(safeModName("../../.ssh/evil.zip"), "evil.zip");
  assert.equal(safeModName("/etc/passwd.zip"), "passwd.zip");
  assert.equal(safeModName("a/b/c/mod.zip"), "mod.zip");
});

test("ไฟล์ที่ไม่ใช่ .zip ไม่รับ", () => {
  assert.equal(safeModName("script.sh"), null);
  assert.equal(safeModName("mod.zip.sh"), null);
  assert.equal(safeModName("noext"), null);
});

test("ชื่อที่ขึ้นต้นด้วยจุดไม่รับ (กันไฟล์ซ่อนและเศษของ ..)", () => {
  assert.equal(safeModName(".hidden.zip"), null);
  assert.equal(safeModName("..zip"), null);
});

test("ชื่อว่าง/ยาวเกินไม่รับ", () => {
  assert.equal(safeModName(""), null);
  assert.equal(safeModName("   "), null);
  assert.equal(safeModName("x".repeat(200) + ".zip"), null);
});

test("อักขระพิเศษและตัวควบคุมไม่ผ่าน", () => {
  assert.equal(safeModName("mod;rm -rf.zip"), null);
  assert.equal(safeModName("mod$(whoami).zip"), null);
  assert.equal(safeModName("mod\u0000.zip"), null);
  assert.equal(safeModName("mod\n.zip"), null);
});
