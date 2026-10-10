/**
 * ทดสอบด่าน "เห็นแค่เจ้าของเครื่อง"
 *
 * ด่านนี้กันการสั่งรันโปรเซสบนเครื่องผ่านหน้าเว็บ ถ้าพลาดคือแอดมินคนไหนก็เปิด/ปิด
 * เซิร์ฟเวอร์และอัปโหลดไฟล์ลงเครื่องได้ เทสจึงเน้นเคส "ตั้งค่าผิด/ลืมตั้ง"
 * ซึ่งต้องปิดไว้ก่อนเสมอ ไม่ใช่เปิดให้ทุกคน
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwner } from "../src/web/middleware/auth.js";

function withOwner<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.DASHBOARD_OWNER;
  if (value === undefined) delete process.env.DASHBOARD_OWNER;
  else process.env.DASHBOARD_OWNER = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.DASHBOARD_OWNER;
    else process.env.DASHBOARD_OWNER = prev;
  }
}

test("ชื่อตรงกับเจ้าของ -> ผ่าน", () => {
  withOwner("flick", () => assert.equal(isOwner("flick"), true));
});

test("แอดมินคนอื่นไม่ผ่าน", () => {
  withOwner("flick", () => {
    assert.equal(isOwner("Tan"), false);
    assert.equal(isOwner("Aom"), false);
  });
});

test("ลืมตั้ง DASHBOARD_OWNER -> ปิดสำหรับทุกคน ไม่ใช่เปิดให้ทุกคน", () => {
  withOwner(undefined, () => {
    assert.equal(isOwner("flick"), false);
    assert.equal(isOwner(""), false);
    assert.equal(isOwner(undefined), false);
  });
  withOwner("", () => assert.equal(isOwner("flick"), false));
  // ตั้งเป็นช่องว่างล้วนก็ต้องถือว่าไม่ได้ตั้ง
  withOwner("   ", () => assert.equal(isOwner("   "), false));
});

test("ค่าที่ไม่ใช่ข้อความไม่ผ่าน", () => {
  withOwner("flick", () => {
    assert.equal(isOwner(undefined), false);
    assert.equal(isOwner(null), false);
    assert.equal(isOwner(123), false);
    assert.equal(isOwner({}), false);
  });
});

test("ตัวพิมพ์เล็กใหญ่ต้องตรงเป๊ะ", () => {
  withOwner("flick", () => {
    assert.equal(isOwner("Flick"), false);
    assert.equal(isOwner("FLICK"), false);
  });
});

test("ช่องว่างหน้าหลังไม่ถูกมองข้าม (กันบัญชีชื่อคล้ายกัน)", () => {
  withOwner("flick", () => assert.equal(isOwner(" flick"), false));
});
