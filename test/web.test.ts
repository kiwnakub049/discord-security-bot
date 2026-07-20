/**
 * ทดสอบชั้น web — รันโดยไม่ต่อ Discord (startWebServer(undefined))
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 *
 * ครอบคลุมการแก้ security: #2 scrypt async, #3 username validation, #4 CSRF, login lockout
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db (db.ts อ่าน BOT_DB_PATH ตอนโหลด)
const DB_PATH = join(tmpdir(), "bot-test-web.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

// ใช้พอร์ตแยกจากตัวจริง (3000) — จะได้รันเทสได้แม้เปิด npm run web/dev ค้างไว้
const TEST_PORT = 3999;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const ADMIN = "admin";
const PASS = "password123";
let server: Server | undefined;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { addUser } = await import("../src/auth/users.js");
  await addUser(ADMIN, PASS);
  const { config } = await import("../src/config.js");
  config.web.port = TEST_PORT;
  const { startWebServer } = await import("../src/web/server.js");
  server = startWebServer(undefined);

  // รอจน server listen (poll /login)
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/login`, { redirect: "manual" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("web server ไม่ขึ้นภายในเวลา");
});

after(() => {
  server?.close();
});

function login(user: string, pw: string, origin?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (origin) headers.Origin = origin;
  return fetch(`${BASE}/login`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ username: user, password: pw }).toString(),
    redirect: "manual",
  });
}

let cookie = "";

test("GET /api/logs โดยไม่ login → 401", async () => {
  const r = await fetch(`${BASE}/api/logs`, { redirect: "manual" });
  assert.equal(r.status, 401);
});

test("#2 scrypt: login รหัสผิด → /login?error=1", async () => {
  const r = await login(ADMIN, "wrong-pass");
  assert.match(r.headers.get("location") ?? "", /error=1/);
});

test("#2 scrypt: login ถูก → 302 ไป / + ได้ cookie", async () => {
  const r = await login(ADMIN, PASS);
  assert.equal(r.headers.get("location"), "/");
  const sc = r.headers.get("set-cookie");
  assert.ok(sc && sc.startsWith("sid="), "ต้องมี Set-Cookie: sid=");
  cookie = sc.split(";")[0];
});

test("GET /api/me (มี cookie) → username ถูก", async () => {
  const r = await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { username: ADMIN });
});

test("#4 CSRF: POST + Origin ต่างเว็บ → 403", async () => {
  const r = await fetch(`${BASE}/api/action/lock`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "http://evil.example.com" },
    body: "{}",
  });
  assert.equal(r.status, 403);
});

test("#4 CSRF: POST same-origin → ไม่โดนบล็อก (≠403)", async () => {
  const r = await fetch(`${BASE}/api/action/lock`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE },
    body: "{}",
  });
  assert.notEqual(r.status, 403);
});

test('#4 CSRF: "Origin: null" (sandboxed iframe) → 403', async () => {
  const r = await fetch(`${BASE}/api/action/lock`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "null" },
    body: "{}",
  });
  assert.equal(r.status, 403);
});

test("#4 Referrer-Policy ต้องเป็น same-origin — no-referrer จะทำให้เบราว์เซอร์ส่ง Origin: null จน login โดน CSRF block", async () => {
  const r = await fetch(`${BASE}/login`);
  assert.equal(r.headers.get("referrer-policy"), "same-origin");
});

test("#3 username อักขระอันตราย → 400", async () => {
  const r = await fetch(`${BASE}/api/users/add`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ username: "ev'il<script>", password: "password123" }),
  });
  assert.equal(r.status, 400);
});

test("#3/#2 username ถูกต้อง + addUser async → 200", async () => {
  const r = await fetch(`${BASE}/api/users/add`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ username: "mod_test.02", password: "password123" }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test("GET /api/activity/:id → มี xp/level/pct", async () => {
  const r = await fetch(`${BASE}/api/activity/123`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const b = await r.json();
  for (const k of ["xp", "level", "pct", "voiceSeconds"]) assert.ok(k in b, `ต้องมี field ${k}`);
});

test("GET /api/leaderboard → { by, entries[] }", async () => {
  const r = await fetch(`${BASE}/api/leaderboard?by=xp&limit=5`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.by, "xp");
  assert.ok(Array.isArray(b.entries));
});

// ทำท้ายสุด — จะล็อก IP 127.0.0.1
test("login lockout: โดนล็อกหลังลองผิดครบ 5 ครั้ง", async () => {
  let lockedAt = 0;
  for (let i = 1; i <= 6; i++) {
    const r = await login(ADMIN, "still-wrong");
    if ((r.headers.get("location") ?? "").includes("locked=") && !lockedAt) lockedAt = i;
  }
  assert.equal(lockedAt, 5);
});
