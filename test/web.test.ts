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
  await addUser(ADMIN, PASS, "admin"); // บัญชีทดสอบต้องเป็น admin เพื่อยิง route จัดการบัญชี/ตั้งค่า
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

test("GET /api/me (มี cookie) → username ถูก + มี guildId", async () => {
  const r = await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { username: string; guildId: string | null };
  assert.equal(body.username, ADMIN);
  /*
   * guildId ต้องมีคีย์เสมอ — หน้าเว็บใช้ประกอบลิงก์ห้องใน log
   * ถ้าหายไปเงียบ ๆ ชื่อห้องจะกลายเป็นข้อความธรรมดาโดยไม่มีอะไรฟ้อง
   * ค่าเป็น null ได้ในเทส เพราะรันโดยไม่ได้ต่อ Discord จริง
   */
  assert.ok("guildId" in body, "ต้องมีคีย์ guildId");
  assert.ok(
    body.guildId === null || /^\d{17,20}$/.test(body.guildId),
    `guildId ต้องเป็น null หรือ snowflake — ได้ ${JSON.stringify(body.guildId)}`,
  );
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

// ---- แบ่งชั้นสิทธิ์ admin / mod ----
let modCookie = "";

test("role: สร้างบัญชี mod แล้ว login ได้ + /api/me บอก role=mod", async () => {
  const { addUser } = await import("../src/auth/users.js");
  await addUser("mod_only", "password123", "mod");
  const r = await login("mod_only", "password123");
  assert.equal(r.headers.get("location"), "/");
  modCookie = (r.headers.get("set-cookie") ?? "").split(";")[0];

  const me = await fetch(`${BASE}/api/me`, { headers: { Cookie: modCookie } });
  assert.equal((await me.json()).role, "mod");
});

test("role: admin /api/me → role=admin", async () => {
  const me = await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } });
  assert.equal((await me.json()).role, "admin");
});

for (const [method, path, body] of [
  ["POST", "/api/users/add", { username: "sneaky", password: "password123" }],
  ["POST", "/api/settings", { "antiSpam.maxMessages": 99 }],
  ["GET", "/api/users", undefined],
] as const) {
  test(`role: mod ยิง ${method} ${path} → 403`, async () => {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Cookie: modCookie,
        "Content-Type": "application/json",
        Origin: BASE,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.status, 403);
  });
}

test("role: ลบ admin คนสุดท้ายไม่ได้ (กันล็อกตัวเองออกจากการจัดการ)", async () => {
  const r = await fetch(`${BASE}/api/users/remove`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ username: ADMIN }),
  });
  const b = await r.json();
  assert.equal(b.ok, false, "ต้องปฏิเสธการลบ admin คนสุดท้าย");
});

// lockout ต้องปลดเองเมื่อพ้นหน้าต่างเวลา ไม่ใช่ล็อกถาวรจน process restart
// (เดิม fails ค้างที่ max ทำให้ attempt แรกหลังหมดเวลาโดนต่ออายุล็อกทันที)
// ใช้ IP เฉพาะ + ย่อ loginLockMs ให้เร่งเวลาได้ ไม่ไปชนกับ 127.0.0.1 ของเทสอื่น
test("login lockout: ปลดเองหลังพ้นหน้าต่างเวลา (ไม่ล็อกถาวร)", async () => {
  const { beginLoginAttempt, endLoginAttempt } = await import(
    "../src/web/middleware/auth.js"
  );
  const { config } = await import("../src/config.js");
  const ip = "203.0.113.7";
  const origLockMs = config.web.loginLockMs;
  config.web.loginLockMs = 60; // 60ms พอให้ setTimeout รอได้จริง
  try {
    // ลองผิดจนล็อก
    for (let i = 0; i < config.web.loginMaxAttempts; i++) {
      assert.equal(beginLoginAttempt(ip), "ok");
      endLoginAttempt(ip, false);
    }
    assert.equal(beginLoginAttempt(ip), "locked", "ครบโควตาต้องถูกล็อก");

    // รอให้พ้นหน้าต่าง แล้วต้องลองต่อได้อีก (ไม่ค้างล็อกถาวร)
    await new Promise((res) => setTimeout(res, 90));
    assert.equal(
      beginLoginAttempt(ip),
      "ok",
      "พ้นหน้าต่างเวลาแล้วต้องปลดล็อกเอง",
    );
    endLoginAttempt(ip, true); // ล้าง record ทิ้ง
  } finally {
    config.web.loginLockMs = origLockMs;
  }
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
