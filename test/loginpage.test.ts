/**
 * ทดสอบการประกอบหน้า login ฝั่ง server
 *
 * เดิมหน้านี้ใช้ <script> ในไฟล์อ่าน ?error= มาแสดงเอง พอ CSP ตัด
 * script-src 'unsafe-inline' ออก สคริปต์นั้นถูกบล็อกเงียบ ๆ — กรอกรหัสผิดแล้ว
 * หน้าจะเด้งกลับมาเปล่า ๆ ไม่บอกอะไรเลย จึงย้ายมาประกอบฝั่ง server
 *
 * เทสนี้คุมสองเรื่อง: ข้อความต้องขึ้นจริง และค่าจาก query ต้องไม่หลุดเข้า HTML
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "express";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = readFileSync(join(ROOT, "src/web/public/login.html"), "utf8");

/**
 * สำเนาตรรกะเดียวกับ renderLogin() ใน src/web/routes/auth.ts
 *
 * import ของจริงไม่ได้ เพราะไฟล์นั้นลาก express + discord.js + store ทั้งชุดมาด้วย
 * (auth.ts import logger → logStore → db) ซึ่งจะเปิด DB จริงตอนโหลดโมดูล
 */
function renderLogin(query: Request["query"]): string {
  let message = "";
  const locked = Number(query.locked);
  if (Number.isFinite(locked) && locked > 0) {
    const mins = Math.min(999, Math.ceil(locked));
    message = `ลองเข้าสู่ระบบผิดหลายครั้งเกินไป — ถูกล็อกชั่วคราว ลองใหม่อีกครั้งใน ${mins} นาที`;
  } else if (query.error) {
    message = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  }
  return TEMPLATE.replace(
    "<!--ERROR-->",
    message ? `<p class="error" role="alert">${message}</p>` : "",
  );
}

test("เทมเพลตมีจุดสำหรับแทรกข้อความ และไม่มี inline script หลงเหลือ", () => {
  assert.ok(TEMPLATE.includes("<!--ERROR-->"), "ต้องมี <!--ERROR--> ให้แทรก");

  // ตัดคอมเมนต์ออกก่อนตรวจ — ในไฟล์มีคอมเมนต์เตือนว่า "ห้ามมี <script>"
  // ซึ่งไม่ใช่สคริปต์จริง ถ้าไม่ตัดจะจับผิดตัวเอง
  const markup = TEMPLATE.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(
    !/<script[\s>]/i.test(markup),
    "ห้ามมี <script> — CSP ตั้ง script-src 'self' ไว้แล้ว จะถูกบล็อกเงียบ ๆ",
  );
  assert.ok(
    !/\son[a-z]+\s*=/i.test(markup),
    "ห้ามมี onclick/onload ฝังในแท็ก — CSP บล็อกเหมือนกัน",
  );
});

test("ไม่มี query = ไม่มีกล่องข้อความ", () => {
  const html = renderLogin({});
  assert.ok(!html.includes('class="error"'));
  assert.ok(!html.includes("<!--ERROR-->"), "ต้องแทนที่ placeholder ทิ้งไปแล้ว");
});

test("error=1 ขึ้นข้อความรหัสผิด", () => {
  const html = renderLogin({ error: "1" });
  assert.match(html, /ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง/);
  assert.match(html, /role="alert"/);
});

test("locked=N บอกจำนวนนาทีที่ต้องรอ", () => {
  assert.match(renderLogin({ locked: "7" }), /ใน 7 นาที/);
  // ถูกล็อกสำคัญกว่ารหัสผิด — ต้องขึ้นข้อความล็อกเมื่อมาพร้อมกัน
  assert.match(renderLogin({ locked: "3", error: "1" }), /ถูกล็อกชั่วคราว/);
});

test("locked ที่ไม่ใช่ตัวเลขบวก ไม่ทำให้ขึ้นข้อความล็อก", () => {
  for (const v of ["0", "-5", "abc", ""]) {
    assert.ok(
      !renderLogin({ locked: v }).includes("ถูกล็อกชั่วคราว"),
      `locked=${JSON.stringify(v)} ไม่ควรนับว่าถูกล็อก`,
    );
  }
});

test("ค่าจาก query ยัดสคริปต์เข้า HTML ไม่ได้", () => {
  const payloads = [
    "<script>alert(1)</script>",
    '"><img src=x onerror=alert(1)>',
    "1</p><script>alert(1)</script><p>",
  ];
  for (const p of payloads) {
    for (const html of [renderLogin({ locked: p }), renderLogin({ error: p })]) {
      assert.ok(!html.includes("alert(1)"), `หลุดผ่าน payload: ${p}`);
      assert.ok(!html.includes("onerror"), `หลุดผ่าน payload: ${p}`);
    }
  }
});

test("locked ค่ามหาศาลถูกจำกัดเพดาน ไม่ล้นหน้า", () => {
  const html = renderLogin({ locked: "999999999" });
  assert.match(html, /ใน 999 นาที/);
});
