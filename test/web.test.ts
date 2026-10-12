/**
 * ทดสอบชั้น web — รันโดยไม่ต่อ Discord (startWebServer(undefined, …))
 * ใช้ DB ชั่วคราวใน tmp (BOT_DB_PATH) ไม่แตะ data/bot.db ตัวจริง
 *
 * login ด้วย Discord: แทน Discord จริงด้วย fetch ปลอม (code → ตัวตน)
 * และแทนการถามยศด้วยตาราง grants — แก้ตารางกลางเทสได้ เพื่อจำลองการถอดยศ
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { Access } from "../src/auth/access.js";

// ต้องตั้ง env ก่อน import โมดูลใด ๆ ที่แตะ db (db.ts อ่าน BOT_DB_PATH ตอนโหลด)
const DB_PATH = join(tmpdir(), "bot-test-web.db");
process.env.BOT_DB_PATH = DB_PATH;
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";

// ใช้พอร์ตแยกจากตัวจริง (3000) — จะได้รันเทสได้แม้เปิด npm run web/dev ค้างไว้
const TEST_PORT = 3999;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
process.env.CLIENT_ID = "app-123";
process.env.DISCORD_CLIENT_SECRET = "secret-xyz";
process.env.DASHBOARD_URL = `${BASE}/`;

const ADMIN_ID = "111111111111111111";
const MOD_ID = "222222222222222222";
const STRANGER_ID = "333333333333333333";
/** admin ของเซิร์ฟที่ไม่ใช่เจ้าของ — ไม่เห็นตั้งค่าระบบ/สถานะ Pi */
const ADMIN2_ID = "444444444444444444";
process.env.DASHBOARD_OWNER = ADMIN_ID;

/** ยศปัจจุบันของแต่ละคน — ลบออกจาก map = จำลองถอดยศ */
const grants = new Map<string, Access>([
  [ADMIN_ID, { role: "admin", name: "admin_user" }],
  [MOD_ID, { role: "mod", name: "mod_user" }],
  [ADMIN2_ID, { role: "admin", name: "admin2_user" }],
]);

/** code ที่ Discord จะส่งกลับมา → คนที่ login (code อื่น = แลกไม่ผ่าน) */
const CODES: Record<string, string> = {
  "code-admin": ADMIN_ID,
  "code-mod": MOD_ID,
  "code-stranger": STRANGER_ID,
  "code-admin2": ADMIN2_ID,
};
const tokenCalls: URLSearchParams[] = [];

const fakeDiscord: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/oauth2/token")) {
    const body = new URLSearchParams(String(init?.body));
    tokenCalls.push(body);
    const who = CODES[body.get("code") ?? ""];
    return who
      ? Response.json({ access_token: `tok-${who}` })
      : Response.json({ error: "invalid_grant" }, { status: 400 });
  }
  if (url.endsWith("/users/@me")) {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const id = auth.replace("Bearer tok-", "");
    return Response.json({ id, username: `discord_${id.slice(0, 3)}` });
  }
  return new Response("not found", { status: 404 });
};

let server: Server | undefined;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.web.port = TEST_PORT;
  const { startWebServer } = await import("../src/web/server.js");
  server = startWebServer(undefined, {
    access: async (id) => grants.get(id) ?? null,
    fetchImpl: fakeDiscord,
  });

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

const cookieNamed = (r: Response, name: string) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);

/** เดินขั้นตอน login ครบ: /auth/discord → (Discord) → /auth/discord/callback */
async function login(code: string, opts: { badState?: boolean } = {}) {
  const start = await fetch(`${BASE}/auth/discord`, { redirect: "manual" });
  const stateCookie = cookieNamed(start, "__Host-oauth") ?? "";
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const q = new URLSearchParams({ code, state: opts.badState ? "forged" : state });
  return fetch(`${BASE}/auth/discord/callback?${q}`, {
    headers: { Cookie: stateCookie },
    redirect: "manual",
  });
}

let cookie = "";

test("/server-icon เปิดได้ก่อน login · ไม่มีบอท → ใช้ icon.svg เดิม", async () => {
  const r = await fetch(`${BASE}/server-icon`, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/icon.svg");
});

test("GET /api/logs โดยไม่ login → 401", async () => {
  const r = await fetch(`${BASE}/api/logs`, { redirect: "manual" });
  assert.equal(r.status, 401);
});

test("หน้า login มีปุ่ม Discord และไม่มีช่องรหัสผ่านแล้ว", async () => {
  const html = await (await fetch(`${BASE}/login`)).text();
  // ปุ่มชี้หน้าอนุญาตของ Discord ตรง ๆ (มือถือจะได้ส่งให้แอป Discord เปิด)
  assert.match(html, /class="discord" href="https:\/\/discord\.com\/oauth2\/authorize\?/);
  assert.doesNotMatch(html, /type="password"/);
});

test("/auth/discord → ส่งไปหน้าอนุญาตของ Discord พร้อม state + ขอแค่ identify", async () => {
  const r = await fetch(`${BASE}/auth/discord`, { redirect: "manual" });
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get("location") ?? "");
  assert.equal(to.origin, "https://discord.com");
  assert.equal(to.searchParams.get("client_id"), "app-123");
  assert.equal(to.searchParams.get("scope"), "identify");
  assert.equal(to.searchParams.get("redirect_uri"), `${BASE}/auth/discord/callback`);
  const state = to.searchParams.get("state") ?? "";
  assert.ok(state.length >= 32, "state ต้องสุ่มยาวพอ");
  assert.equal(cookieNamed(r, "__Host-oauth"), `__Host-oauth=${state}`);
});

test("callback: state ไม่ตรง / ไม่มี cookie state → error=state ไม่แลก code", async () => {
  const before = tokenCalls.length;
  const forged = await login("code-admin", { badState: true });
  assert.match(forged.headers.get("location") ?? "", /error=state/);
  const noCookie = await fetch(`${BASE}/auth/discord/callback?code=code-admin&state=x`, {
    redirect: "manual",
  });
  assert.match(noCookie.headers.get("location") ?? "", /error=state/);
  assert.equal(tokenCalls.length, before, "ต้องไม่ยิงแลก code เลย");
  assert.equal(cookieNamed(forged, "__Host-sid"), undefined);
});

test("callback: กดยกเลิกที่ Discord → error=denied", async () => {
  const r = await fetch(`${BASE}/auth/discord/callback?error=access_denied`, { redirect: "manual" });
  assert.match(r.headers.get("location") ?? "", /error=denied/);
});

test("callback: แลก code ไม่ผ่าน → error=failed", async () => {
  const r = await login("code-expired");
  assert.match(r.headers.get("location") ?? "", /error=failed/);
  assert.equal(cookieNamed(r, "__Host-sid"), undefined);
});

test("callback: บัญชีไม่มียศ → error=norole ไม่ได้ session", async () => {
  const r = await login("code-stranger");
  assert.match(r.headers.get("location") ?? "", /error=norole/);
  assert.equal(cookieNamed(r, "__Host-sid"), undefined);
});

test("login admin สำเร็จ → 302 ไป / + ได้ cookie · แลก code ด้วย secret + redirect_uri", async () => {
  const r = await login("code-admin");
  assert.equal(r.headers.get("location"), "/");
  cookie = cookieNamed(r, "__Host-sid") ?? "";
  assert.ok(cookie, "ต้องมี Set-Cookie: __Host-sid=");
  const sent = tokenCalls.at(-1)!;
  assert.equal(sent.get("client_secret"), "secret-xyz");
  assert.equal(sent.get("redirect_uri"), `${BASE}/auth/discord/callback`);
});

test("GET /api/me (มี cookie) → ชื่อ Discord + role + isOwner + มี guildId", async () => {
  const r = await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as {
    username: string;
    role: string;
    isOwner: boolean;
    guildId: string | null;
  };
  assert.equal(body.username, "admin_user");
  assert.equal(body.role, "admin");
  assert.equal(body.isOwner, true, "DASHBOARD_OWNER เทียบกับ Discord user ID");
  /*
   * guildId ต้องมีคีย์เสมอ — หน้าเว็บใช้ประกอบลิงก์ห้องใน log
   * ค่าเป็น null ได้ในเทส เพราะรันโดยไม่ได้ต่อ Discord จริง
   */
  assert.ok("guildId" in body, "ต้องมีคีย์ guildId");
});

test("/api/sessions เห็นเครื่องที่ login อยู่ของตัวเอง", async () => {
  const r = await fetch(`${BASE}/api/sessions`, { headers: { Cookie: cookie } });
  const list = (await r.json()) as { current: boolean }[];
  assert.ok(list.some((s) => s.current));
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

test("#4 Referrer-Policy ต้องเป็น same-origin — no-referrer จะทำให้เบราว์เซอร์ส่ง Origin: null จนโดน CSRF block", async () => {
  const r = await fetch(`${BASE}/login`);
  assert.equal(r.headers.get("referrer-policy"), "same-origin");
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

test("GET /api/access (admin) → ตอบได้ แม้ไม่ได้ต่อ Discord", async () => {
  const r = await fetch(`${BASE}/api/access`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { roles: [], people: [] });
});

// ---- แบ่งชั้นสิทธิ์ admin / mod ----
let modCookie = "";

test("role: mod login ได้ + /api/me บอก role=mod และไม่ใช่เจ้าของ", async () => {
  const r = await login("code-mod");
  assert.equal(r.headers.get("location"), "/");
  modCookie = cookieNamed(r, "__Host-sid") ?? "";
  const me = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: modCookie } })).json();
  assert.equal(me.role, "mod");
  assert.equal(me.isOwner, false);
});

test("role: mod แก้ตั้งค่าบอทได้ แต่ไม่เห็น/แก้ยศ admin-mod ของ dashboard ไม่ได้", async () => {
  const { config } = await import("../src/config.js");
  const before = [...config.dashboard.adminRoleIds];
  const headers = { Cookie: modCookie, "Content-Type": "application/json", Origin: BASE };

  const list = await (await fetch(`${BASE}/api/settings`, { headers })).json();
  const keys = list.flatMap((s: { items: { key: string }[] }) => s.items.map((i) => i.key));
  assert.ok(keys.includes("antiSpam.maxMessages"));
  assert.ok(!keys.some((k: string) => k.startsWith("dashboard.")), "mod ต้องไม่เห็นยศของ dashboard");

  const r = await fetch(`${BASE}/api/settings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ "antiSpam.maxMessages": 9, "dashboard.adminRoleIds": ["999999999999999999"] }),
  });
  assert.equal(r.status, 200);
  assert.equal(config.antiSpam.maxMessages, 9);
  assert.deepEqual(config.dashboard.adminRoleIds, before, "mod ต้องเลื่อนขั้นตัวเองไม่ได้");

  assert.equal((await fetch(`${BASE}/api/access`, { headers })).status, 200);
});

test("role: mod ใช้ผู้ช่วย AI ได้", async () => {
  const r = await fetch(`${BASE}/api/chat/threads`, { headers: { Cookie: modCookie } });
  assert.equal(r.status, 200);
});

test("เจ้าของเห็นยศ admin-mod ของ dashboard", async () => {
  const list = await (await fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } })).json();
  const keys = list.flatMap((s: { items: { key: string }[] }) => s.items.map((i) => i.key));
  assert.ok(keys.includes("dashboard.adminRoleIds"));
});

// ---- ตั้งค่าระบบ + สถานะ Pi: mod เห็น, admin คนอื่นไม่เห็น, เจ้าของเห็น ----
test("seesSystem: mod เห็นสถานะเครื่อง/OLED", async () => {
  const me = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: modCookie } })).json();
  assert.equal(me.seesSystem, true);
  for (const path of ["/api/system", "/api/oled"]) {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: modCookie } });
    assert.equal(r.status, 200, path);
  }
});

test("seesSystem: admin ที่ไม่ใช่เจ้าของ → 403 ทั้งสถานะเครื่อง/ตั้งค่า/OLED/รายชื่อ", async () => {
  const r = await login("code-admin2");
  const c = cookieNamed(r, "__Host-sid") ?? "";
  const me = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: c } })).json();
  assert.equal(me.role, "admin");
  assert.equal(me.seesSystem, false);
  for (const [method, path, body] of [
    ["GET", "/api/system", undefined],
    ["GET", "/api/settings", undefined],
    ["POST", "/api/settings", { "antiSpam.maxMessages": 99 }],
    ["GET", "/api/oled", undefined],
    ["POST", "/api/oled", { page: "load" }],
    ["GET", "/api/access", undefined],
    ["GET", "/api/chat/threads", undefined],
    ["POST", "/api/ai/test", { text: "ทดสอบ" }],
  ] as const) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Cookie: c, "Content-Type": "application/json", Origin: BASE },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  // เครื่องมือดูแลสมาชิกยังใช้ได้ปกติ
  assert.equal((await fetch(`${BASE}/api/logs`, { headers: { Cookie: c } })).status, 200);
});

test("seesSystem: เจ้าของ (admin) เห็นทุกอย่าง", async () => {
  const me = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(me.seesSystem, true);
  for (const path of ["/api/system", "/api/settings", "/api/oled", "/api/access"]) {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200, path);
  }
});

test("ระบบบัญชีรหัสผ่านเดิมไม่มีแล้ว", async () => {
  const login = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
    body: "username=admin&password=password123",
    redirect: "manual",
  });
  assert.equal(cookieNamed(login, "__Host-sid"), undefined, "POST /login ต้องไม่ได้ session");
  const users = await fetch(`${BASE}/api/users`, { headers: { Cookie: cookie } });
  assert.equal(users.status, 404);
});

test("ถอดยศแล้ว request ถัดไปหลุดทันที และ session ถูกทิ้ง", async () => {
  grants.delete(MOD_ID);
  const api = await fetch(`${BASE}/api/me`, { headers: { Cookie: modCookie } });
  assert.equal(api.status, 401);
  // ให้ยศคืนแล้ว cookie เดิมก็ต้องใช้ไม่ได้ (session ถูกลบไปแล้ว ต้อง login ใหม่)
  grants.set(MOD_ID, { role: "mod", name: "mod_user" });
  const again = await fetch(`${BASE}/api/me`, { headers: { Cookie: modCookie } });
  assert.equal(again.status, 401);
});

test("ถอดยศแล้วเปิดหน้าเว็บ → เด้งไป login พร้อมบอกเหตุผล", async () => {
  const r = await login("code-mod");
  const c = cookieNamed(r, "__Host-sid") ?? "";
  grants.delete(MOD_ID);
  const page = await fetch(`${BASE}/`, { headers: { Cookie: c }, redirect: "manual" });
  assert.match(page.headers.get("location") ?? "", /\/login\?error=norole/);
  grants.set(MOD_ID, { role: "mod", name: "mod_user" });
});

test("ยังไม่ได้ตั้งค่า OAuth → /auth/discord บอกว่าต้องตั้งอะไร", async () => {
  const saved = process.env.DISCORD_CLIENT_SECRET;
  delete process.env.DISCORD_CLIENT_SECRET;
  try {
    const r = await fetch(`${BASE}/auth/discord`, { redirect: "manual" });
    assert.match(r.headers.get("location") ?? "", /error=config/);
    const html = await (await fetch(`${BASE}/login`)).text();
    assert.match(html, /DISCORD_CLIENT_SECRET/);
  } finally {
    process.env.DISCORD_CLIENT_SECRET = saved;
  }
});

test("/api/avatar/:id ต้อง login · ไม่ได้ต่อ Discord → 404 (หน้าเว็บแสดงอักษรแทน)", async () => {
  const anon = await fetch(`${BASE}/api/avatar/${ADMIN_ID}`, { redirect: "manual" });
  assert.equal(anon.status, 401);
  const r = await fetch(`${BASE}/api/avatar/${ADMIN_ID}`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(r.status, 404);
});

test("CSP อนุญาตรูปจาก CDN ของ Discord เท่านั้น (รูปโปรไฟล์)", async () => {
  const csp = (await fetch(`${BASE}/login`)).headers.get("content-security-policy") ?? "";
  assert.match(csp, /img-src 'self' data: blob: https:\/\/cdn\.discordapp\.com(;|$)/);
});
