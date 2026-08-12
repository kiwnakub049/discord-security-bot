/**
 * ทดสอบ setPassword — ตัวที่ npm run user:passwd เรียกใช้
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db (db.ts อ่าน BOT_DB_PATH ตอนโหลด)
const DB_PATH = join(tmpdir(), "bot-test-passwd.db");
process.env.BOT_DB_PATH = DB_PATH;

const USER = "somchai";
const OLD = "รหัสเดิม12345";
const NEW = "รหัสใหม่67890";

let addUser: typeof import("../src/auth/users.js").addUser;
let setPassword: typeof import("../src/auth/users.js").setPassword;
let verifyPassword: typeof import("../src/auth/users.js").verifyPassword;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  ({ addUser, setPassword, verifyPassword } = await import(
    "../src/auth/users.js"
  ));
  await addUser(USER, OLD);
});

test("ตั้งรหัสใหม่แล้วรหัสใหม่ใช้ได้", async () => {
  assert.equal(await setPassword(USER, NEW), true);
  assert.equal(await verifyPassword(USER, NEW), true);
});

test("รหัสเดิมต้องใช้ไม่ได้อีก — ไม่งั้นเปลี่ยนไปก็ไม่ช่วยอะไร", async () => {
  assert.equal(await verifyPassword(USER, OLD), false);
});

test("ไม่มี user นี้ = คืน false ไม่ใช่สร้างใหม่เงียบ ๆ", async () => {
  assert.equal(await setPassword("ไม่มีคนนี้", NEW), false);
  assert.equal(await verifyPassword("ไม่มีคนนี้", NEW), false);
});

test("salt เปลี่ยนทุกครั้ง ตั้งรหัสเดิมซ้ำก็ได้ hash คนละอัน", async () => {
  const { db } = await import("../src/store/db.js");
  const read = () =>
    db.prepare("SELECT salt, hash FROM users WHERE username = ?").get(USER) as {
      salt: string;
      hash: string;
    };
  const before = read();
  await setPassword(USER, NEW); // รหัสเดิมเป๊ะ ๆ
  const after = read();
  assert.notEqual(before.salt, after.salt);
  assert.notEqual(before.hash, after.hash);
  assert.equal(await verifyPassword(USER, NEW), true);
});
