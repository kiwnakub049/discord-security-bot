/**
 * ทดสอบ session ที่เก็บใน DB
 *
 * นี่คือโค้ดที่ตัดสินว่าใครเข้า dashboard ได้ — พลาดตรงนี้แปลว่าคนนอกเข้าได้
 * หรือเจ้าของเข้าไม่ได้ ทั้งสองแบบไม่มีอะไรเตือนจนกว่าจะมีคนเจอเอง
 *
 * ต้องตั้ง env ก่อน import เพราะ db.ts กับ session.ts อ่านตอนโหลดโมดูล
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sess-"));
process.env.BOT_DB_PATH = join(dir, "test.db");
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

type Mod = typeof import("../src/auth/session.js");
let S: Mod;
let db: (typeof import("../src/store/db.js"))["db"];

const META = { userAgent: "Mozilla/5.0 (iPhone) Safari/605", ip: "100.64.0.9" };

before(async () => {
  S = await import("../src/auth/session.js");
  db = (await import("../src/store/db.js")).db;
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("login แล้วใช้ cookie นั้นเข้าได้", () => {
  const cookie = S.createSession("flick", META);
  const got = S.resolveSession(cookie, META);
  assert.equal(got?.username, "flick");
});

test("cookie ที่ถูกแก้ลายเซ็นใช้ไม่ได้", () => {
  const cookie = S.createSession("flick", META);
  const [token, mac] = cookie.split(".");

  for (const bad of [
    `${token}.${"0".repeat(mac!.length)}`, // ลายเซ็นผิด
    `${token}.`, // ไม่มีลายเซ็น
    token!, // ไม่มีจุดเลย
    `${"a".repeat(64)}.${mac}`, // token ปลอม ลายเซ็นของอันอื่น
    "",
  ]) {
    assert.equal(S.resolveSession(bad, META), null, `ต้องปฏิเสธ: ${bad.slice(0, 24)}`);
  }
  assert.equal(S.resolveSession(undefined, META), null);
});

test("DB เก็บ hash ไม่ใช่ token ตัวจริง", () => {
  // สำคัญ: ไฟล์ DB ถูกสำรองเป็น .gz ทุกคืนและก็อปออกนอกเครื่องได้
  // ถ้าเก็บ token ดิบ ใครได้ไฟล์สำรองก็สวมสิทธิ์ได้ทันที
  const cookie = S.createSession("flick", META);
  const token = cookie.split(".")[0]!;
  const rows = db.prepare("SELECT id FROM sessions").all() as { id: string }[];
  assert.ok(
    rows.every((r) => r.id !== token),
    "ห้ามมี token ดิบอยู่ในตาราง",
  );
  assert.ok(S.resolveSession(cookie, META), "แต่ cookie เดิมต้องยังใช้ได้");
});

test("logout แล้ว cookie เดิมใช้ไม่ได้ทันที", () => {
  const cookie = S.createSession("flick", META);
  assert.ok(S.resolveSession(cookie, META));
  S.destroySession(cookie);
  assert.equal(S.resolveSession(cookie, META), null);
});

test("session ที่หมดอายุแล้วใช้ไม่ได้ และถูกลบทิ้ง", () => {
  const cookie = S.createSession("flick", META);
  const before = S.resolveSession(cookie, META);
  assert.ok(before);

  // ดันวันหมดอายุให้เป็นอดีต
  db.prepare("UPDATE sessions SET expires = ? WHERE id = ?").run(
    Date.now() - 1000,
    before.id,
  );

  assert.equal(S.resolveSession(cookie, META), null);
  const left = db.prepare("SELECT count(*) c FROM sessions WHERE id = ?").get(before.id) as {
    c: number;
  };
  assert.equal(left.c, 0, "ต้องถูกลบทิ้ง ไม่ใช่แค่ปฏิเสธ");
});

test("ใช้งานเรื่อย ๆ แล้ววันหมดอายุถูกเลื่อนออกไป", () => {
  const cookie = S.createSession("flick", META);
  const first = S.resolveSession(cookie, META)!;

  // ทำให้เหมือนใช้ครั้งล่าสุดเมื่อ 10 นาทีก่อน (เกินระยะที่ยอมให้ข้ามการเขียน)
  const old = Date.now() - 10 * 60 * 1000;
  db.prepare("UPDATE sessions SET last_seen = ?, expires = ? WHERE id = ?").run(
    old,
    old + S.SESSION_TTL_MS,
    first.id,
  );
  const beforeExp = (
    db.prepare("SELECT expires FROM sessions WHERE id = ?").get(first.id) as {
      expires: number;
    }
  ).expires;

  const again = S.resolveSession(cookie, META)!;
  assert.equal(again.refreshed, true, "ควรต่ออายุให้");

  const afterExp = (
    db.prepare("SELECT expires FROM sessions WHERE id = ?").get(first.id) as {
      expires: number;
    }
  ).expires;
  assert.ok(afterExp > beforeExp, "วันหมดอายุต้องถูกเลื่อนออกไป");
});

test("ใช้ถี่ ๆ ไม่เขียน DB ซ้ำทุกครั้ง", () => {
  // หน้าเว็บ poll ทุก 10 วินาที ถ้าเขียนทุก request จะเปลืองการเขียนลง SD card เปล่า ๆ
  const cookie = S.createSession("flick", META);
  S.resolveSession(cookie, META);
  const second = S.resolveSession(cookie, META);
  assert.equal(second?.refreshed, false);
});

test("เห็นเฉพาะอุปกรณ์ของบัญชีตัวเอง", () => {
  db.prepare("DELETE FROM sessions").run();
  S.createSession("flick", META);
  S.createSession("flick", META);
  S.createSession("someone", META);

  assert.equal(S.listSessions("flick").length, 2);
  assert.equal(S.listSessions("someone").length, 1);
  assert.equal(S.listSessions("ไม่มีคนนี้").length, 0);
});

test("เตะ session ของคนอื่นไม่ได้ แม้จะรู้ id", () => {
  db.prepare("DELETE FROM sessions").run();
  const victim = S.createSession("someone", META);
  const victimId = S.resolveSession(victim, META)!.id;

  assert.equal(S.revokeSession("flick", victimId), false, "ต้องเตะไม่สำเร็จ");
  assert.ok(S.resolveSession(victim, META), "ของเจ้าตัวต้องยังใช้ได้");
  assert.equal(S.revokeSession("someone", victimId), true, "เจ้าของเตะเองได้");
});

test("ออกทุกเครื่องยกเว้นเครื่องนี้", () => {
  db.prepare("DELETE FROM sessions").run();
  const keep = S.createSession("flick", META);
  S.createSession("flick", META);
  S.createSession("flick", META);
  S.createSession("someone", META); // ของคนอื่น ต้องไม่โดนด้วย

  const keepId = S.resolveSession(keep, META)!.id;
  assert.equal(S.revokeOtherSessions("flick", keepId), 2);
  assert.equal(S.listSessions("flick").length, 1);
  assert.ok(S.resolveSession(keep, META), "เครื่องที่ใช้อยู่ต้องรอด");
  assert.equal(S.listSessions("someone").length, 1, "ของคนอื่นต้องไม่โดนเตะ");
});

test("pruneSessions ลบเฉพาะที่หมดอายุ", () => {
  db.prepare("DELETE FROM sessions").run();
  const live = S.createSession("flick", META);
  const dead = S.createSession("flick", META);
  db.prepare("UPDATE sessions SET expires = ? WHERE id = ?").run(
    Date.now() - 1,
    S.resolveSession(dead, META)!.id,
  );

  assert.equal(S.pruneSessions(), 1);
  assert.ok(S.resolveSession(live, META), "ตัวที่ยังไม่หมดอายุต้องอยู่");
});
