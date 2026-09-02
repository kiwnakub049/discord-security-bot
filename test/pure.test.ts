/**
 * กันไม่ให้ formula-injection guard ของไฟล์ CSV หลุดหายตอนแก้ dashboard ครั้งหน้า
 *
 * เดิมเทสนี้ดึงฟังก์ชัน esc() กับ csvCell() ออกจาก <script> ใน index.html มา eval
 * ตอนนี้หน้าเว็บเขียนใหม่ด้วย React แล้ว:
 *  - esc() ไม่ต้องมีอีก JSX escape ข้อความให้เองทุกจุดโดยโครงสร้างของภาษา
 *  - csvCell() ย้ายมาอยู่ฝั่ง server ที่ src/web/csv.ts เพราะการส่งออกทำที่นั่นแล้ว
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOM, csvCell, toCsv } from "../src/web/csv.js";

test("csvCell(): เติม ' นำหน้าเซลล์ที่ขึ้นต้นด้วย = + - @", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.ok(csvCell("+cmd").startsWith("'"));
  assert.ok(csvCell("-2+3").startsWith("'"));
  assert.ok(csvCell("@SUM").startsWith("'"));
  assert.ok(csvCell("=HYPERLINK(x)").startsWith("'"));
});

test("csvCell(): tab และ CR ก็เป็นจุดเริ่มสูตรได้เหมือนกัน", () => {
  assert.ok(csvCell("\t=cmd").startsWith("'"));
  assert.ok(csvCell("\r=cmd").startsWith("'"));
});

test("csvCell(): ค่าปกติ / comma / quote / ขึ้นบรรทัด", () => {
  assert.equal(csvCell("hello"), "hello");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('เขาพูดว่า "ไง"'), '"เขาพูดว่า ""ไง"""');
  assert.equal(csvCell("บรรทัด1\nบรรทัด2"), '"บรรทัด1\nบรรทัด2"');
});

test("csvCell(): null / undefined กลายเป็นช่องว่าง ไม่ใช่ข้อความ null", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(0), "0");
});

test("csvCell(): เซลล์ที่มีทั้งสูตรและ comma ต้องได้ทั้งสองอย่าง", () => {
  // ต้องเติม ' ก่อน แล้วค่อยครอบ quote — ไม่งั้น ' ไปโผล่นอกเครื่องหมายคำพูด
  assert.equal(csvCell("=SUM(A1,A2)"), `"'=SUM(A1,A2)"`);
});

test("toCsv(): หัวตารางกับแถวข้อมูลต่อกันถูกบรรทัด", () => {
  const csv = toCsv(
    ["เวลา", "หัวข้อ"],
    [
      ["12:00", "ปกติ"],
      ["12:01", "=evil()"],
    ],
  );
  assert.deepEqual(csv.split("\n"), ["เวลา,หัวข้อ", "12:00,ปกติ", "12:01,'=evil()"]);
});

test("BOM มีอยู่จริง — ขาดไปแล้ว Excel อ่านภาษาไทยเพี้ยน", () => {
  assert.equal(BOM, "﻿");
});
