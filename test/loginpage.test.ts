/**
 * ทดสอบการประกอบหน้า login ฝั่ง server
 *
 * หน้า login ห้ามมี <script> (CSP บล็อกเงียบ ๆ) ข้อความแจ้งเตือนเลยประกอบฝั่ง server
 * เทสนี้คุมสองเรื่อง: ข้อความต้องขึ้นจริง และค่าจาก query ต้องไม่หลุดเข้า HTML
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// auth.ts ลาก logger → logStore → db มาด้วย — ชี้ DB ไปที่ tmp ก่อน import
const DB_PATH = join(tmpdir(), "bot-test-loginpage.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";
process.env.CLIENT_ID = "app-123";
process.env.DISCORD_CLIENT_SECRET = "secret";
process.env.DASHBOARD_URL = "https://bot.example.com";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = readFileSync(join(ROOT, "src/web/public/login.html"), "utf8");

let renderLogin: typeof import("../src/web/routes/auth.js")["renderLogin"];

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  ({ renderLogin } = await import("../src/web/routes/auth.js"));
});

test("เทมเพลตมีจุดสำหรับแทรกข้อความ ปุ่ม Discord และไม่มี inline script", () => {
  assert.ok(TEMPLATE.includes("<!--ERROR-->"), "ต้องมี <!--ERROR--> ให้แทรก");
  assert.match(TEMPLATE, /href="\/auth\/discord"/);

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

test("error แต่ละแบบขึ้นข้อความของตัวเอง", () => {
  assert.match(renderLogin({ error: "norole" }), /ไม่มียศแอดมินหรือ mod/);
  assert.match(renderLogin({ error: "state" }), /กดเข้าสู่ระบบใหม่/);
  assert.match(renderLogin({ error: "failed" }), /เชื่อมต่อ Discord ไม่สำเร็จ/);
  assert.match(renderLogin({ error: "denied" }), /ยกเลิก/);
  assert.match(renderLogin({ error: "norole" }), /role="alert"/);
});

test("error ที่ไม่รู้จัก ไม่ขึ้นข้อความ", () => {
  assert.ok(!renderLogin({ error: "1" }).includes('class="error"'));
});

test("ยังตั้งค่า OAuth ไม่ครบ → บอกว่าต้องตั้งอะไรตั้งแต่เปิดหน้า", () => {
  const saved = process.env.DASHBOARD_URL;
  delete process.env.DASHBOARD_URL;
  try {
    assert.match(renderLogin({}), /DASHBOARD_URL/);
  } finally {
    process.env.DASHBOARD_URL = saved;
  }
});

test("ค่าจาก query ยัดสคริปต์เข้า HTML ไม่ได้", () => {
  const payloads = [
    "<script>alert(1)</script>",
    '"><img src=x onerror=alert(1)>',
    "1</p><script>alert(1)</script><p>",
  ];
  for (const p of payloads) {
    const html = renderLogin({ error: p });
    assert.ok(!html.includes("alert(1)"), `หลุดผ่าน payload: ${p}`);
    assert.ok(!html.includes("onerror"), `หลุดผ่าน payload: ${p}`);
  }
});
