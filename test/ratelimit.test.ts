/**
 * ทดสอบ rateLimit middleware (fixed window ต่อ IP) แบบ unit — ไม่ต้องเปิด server
 * ใช้ DB ชั่วคราว (BOT_DB_PATH) กันการ import ห่วงโซ่ไปแตะ db จริง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botrl-")), "test.db");

const { rateLimit, resetRateLimits } = await import("../src/web/middleware/rateLimit.js");

function fakeReqRes(ip: string) {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let body: unknown;
  const req = { ip } as never;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (c: number) => {
      statusCode = c;
      return res;
    },
    json: (b: unknown) => {
      body = b;
    },
  } as never;
  return { req, res, out: () => ({ statusCode, headers, body }) };
}

test("rateLimit: ผ่านจนถึง max แล้วโดน 429 + Retry-After", () => {
  resetRateLimits();
  let trips = 0;
  const mw = rateLimit("t1", 2, 60_000, () => trips++);
  let passed = 0;
  for (let i = 0; i < 4; i++) {
    const { req, res, out } = fakeReqRes("10.0.0.1");
    mw(req, res, () => passed++);
    if (i >= 2) {
      assert.equal(out().statusCode, 429, `ครั้งที่ ${i + 1} ต้อง 429`);
      assert.ok(Number(out().headers["Retry-After"]) > 0, "ต้องมี Retry-After");
    }
  }
  assert.equal(passed, 2, "ผ่านแค่ 2 ครั้งแรก");
  assert.equal(trips, 1, "onTrip ยิงครั้งเดียวต่อ window (กันสแปมช่องแจ้งเตือน)");
});

test("rateLimit: คนละ IP คนละโควตา / คนละ name คนละโควตา", () => {
  resetRateLimits();
  const mw = rateLimit("t2", 1, 60_000);
  let a = 0;
  const r1 = fakeReqRes("10.0.0.1");
  const r2 = fakeReqRes("10.0.0.2");
  mw(r1.req, r1.res, () => a++);
  mw(r2.req, r2.res, () => a++);
  assert.equal(a, 2, "IP ต่างกันไม่กินโควตากัน");

  const other = rateLimit("t3", 1, 60_000);
  const r3 = fakeReqRes("10.0.0.1");
  other(r3.req, r3.res, () => a++);
  assert.equal(a, 3, "name ต่างกันไม่กินโควตากัน");
});
