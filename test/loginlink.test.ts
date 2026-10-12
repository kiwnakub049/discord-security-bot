/**
 * login ผ่านแอป Discord
 * - ลิงก์ครั้งเดียวจาก /dashboard: ใช้ได้ครั้งเดียว, หมดอายุ, GET ไม่ใช้ token, ถอดยศแล้วเข้าไม่ได้
 * - คำสั่ง /dashboard: ไม่มียศ → ปฏิเสธ · มียศ → ephemeral + ปุ่มลิงก์
 * - state ของ OAuth: ขากลับไม่มี cookie แต่ state เป็นของเรา → ผ่าน (ใช้ได้ครั้งเดียว)
 * server จริง (ไม่มีบอท) + Discord ปลอม · DB ชั่วคราวใน tmp
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botlink-")), "test.db");
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";
const PORT = 3871;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.CLIENT_ID = "app-123";
process.env.DISCORD_CLIENT_SECRET = "secret-xyz";
process.env.DASHBOARD_URL = `${BASE}/`;

const MOD = "222222222222222222";
const grants = new Map([[MOD, { role: "mod" as const, name: "mod_user" }]]);

const fakeDiscord: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/oauth2/token")) {
    return new URLSearchParams(String(init?.body)).get("code") === "good"
      ? Response.json({ access_token: "tok" })
      : Response.json({ error: "invalid_grant" }, { status: 400 });
  }
  if (url.endsWith("/users/@me")) return Response.json({ id: MOD, username: "mod_user" });
  return new Response("not found", { status: 404 });
};

type Link = typeof import("../src/auth/loginLink.js");
let link: Link;
let server: Server;

before(async () => {
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.web.port = PORT;
  config.web.host = "127.0.0.1";
  link = await import("../src/auth/loginLink.js");
  const { startWebServer } = await import("../src/web/server.js");
  server = startWebServer(undefined, { access: async (id) => grants.get(id) ?? null, fetchImpl: fakeDiscord });
  await new Promise((r) => setTimeout(r, 300));
});

after(() => server?.close());

const sid = (r: Response) =>
  r.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => /^__Host-sid=.+/.test(c));
const postLink = (t: string) =>
  fetch(`${BASE}/auth/link`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
    body: new URLSearchParams({ t }),
    redirect: "manual",
  });

test("store: ใช้ได้ครั้งเดียว · หมดอายุ · token มั่ว", () => {
  const t = link.createLoginLink(MOD);
  assert.equal(link.peekLoginLink(t), MOD);
  assert.equal(link.consumeLoginLink(t), MOD);
  assert.equal(link.consumeLoginLink(t), null, "ใช้ซ้ำไม่ได้");
  assert.equal(link.peekLoginLink(t), null);

  const old = link.createLoginLink(MOD, Date.now() - link.LINK_TTL_MS - 1000);
  assert.equal(link.consumeLoginLink(old), null, "หมดอายุ");
  assert.equal(link.consumeLoginLink("nope"), null);
  assert.equal(link.consumeLoginLink(undefined), null);
});

test("GET /auth/link = หน้ายืนยัน ไม่ใช้ token · POST แล้วได้ session · ใช้ซ้ำ → เด้งกลับ", async () => {
  const t = link.createLoginLink(MOD);
  for (let i = 0; i < 2; i++) {
    const page = await fetch(`${BASE}/auth/link?t=${t}`, { redirect: "manual" });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<form method="post" action="\/auth\/link">/);
    assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ""), /<script[\s>]/i);
  }
  const r = await postLink(t);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/");
  const cookie = sid(r);
  assert.ok(cookie, "ต้องได้ cookie session");
  const me = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie! } })).json();
  assert.equal(me.userId, MOD);

  const again = await postLink(t);
  assert.equal(again.headers.get("location"), "/login?error=link");
  assert.equal(sid(again), undefined);
  assert.equal((await fetch(`${BASE}/auth/link?t=${t}`, { redirect: "manual" })).headers.get("location"), "/login?error=link");
});

test("ถอดยศระหว่างขอลิงก์กับกด → เข้าไม่ได้", async () => {
  const t = link.createLoginLink(MOD);
  grants.delete(MOD);
  try {
    const r = await postLink(t);
    assert.equal(r.headers.get("location"), "/login?error=norole");
    assert.equal(sid(r), undefined);
  } finally {
    grants.set(MOD, { role: "mod", name: "mod_user" });
  }
});

test("หน้า login: ข้อความลิงก์หมดอายุ + บอกให้ใช้ /dashboard", async () => {
  const html = await (await fetch(`${BASE}/login?error=link`)).text();
  assert.match(html, /ลิงก์หมดอายุ/);
  assert.match(html, /\/dashboard/);
});

test("หน้า login: ปุ่มชี้ discord.com ตรง ๆ พร้อม state ที่ตรงกับ cookie", async () => {
  const r = await fetch(`${BASE}/login`);
  const html = await r.text();
  const href = /class="discord" href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  assert.ok(href?.startsWith("https://discord.com/oauth2/authorize?"), href);
  const state = new URL(href!).searchParams.get("state");
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith("__Host-oauth="));
  assert.equal(cookie?.split(";")[0], `__Host-oauth=${state}`);
});

test("callback: ไม่มี cookie แต่ state เราออกให้ → ผ่าน · ใช้ state ซ้ำ/มั่ว → ไม่ผ่าน", async () => {
  const html = await (await fetch(`${BASE}/login`)).text();
  const href = /class="discord" href="([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&");
  const state = new URL(href).searchParams.get("state")!;

  // จำลองแอป Discord พากลับมาใน browser ในแอป — ไม่มี cookie state
  const ok = await fetch(`${BASE}/auth/discord/callback?code=good&state=${state}`, { redirect: "manual" });
  assert.equal(ok.headers.get("location"), "/");
  assert.ok(sid(ok));

  const reuse = await fetch(`${BASE}/auth/discord/callback?code=good&state=${state}`, { redirect: "manual" });
  assert.equal(reuse.headers.get("location"), "/login?error=state");
  const forged = await fetch(`${BASE}/auth/discord/callback?code=good&state=forged`, { redirect: "manual" });
  assert.equal(forged.headers.get("location"), "/login?error=state");
});

/* ---------- คำสั่ง /dashboard ---------- */

function mockInteraction(opts: { admin?: boolean; roles?: string[] }) {
  const replies: { content: string; flags?: number; components?: { toJSON(): unknown }[] }[] = [];
  const interaction = {
    user: { id: MOD },
    member: {
      permissions: { has: (p: bigint) => !!opts.admin && p === PermissionFlagsBits.Administrator },
      roles: { cache: { has: (id: string) => (opts.roles ?? []).includes(id) } },
    },
    reply: async (r: (typeof replies)[number]) => void replies.push(r),
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

test("/dashboard: ไม่มียศ → ปฏิเสธ (ephemeral)", async () => {
  const { dashboard } = await import("../src/commands/dashboard.js");
  const m = mockInteraction({});
  await dashboard.execute(m.interaction);
  assert.equal(m.replies[0]?.flags, MessageFlags.Ephemeral);
  assert.match(m.replies[0]!.content, /ไม่มีสิทธิ์/);
  assert.equal(m.replies[0]?.components, undefined);
});

test("/dashboard: มียศ → ephemeral + ปุ่มลิงก์ที่ใช้ได้จริง", async () => {
  const { dashboard } = await import("../src/commands/dashboard.js");
  const m = mockInteraction({ admin: true });
  await dashboard.execute(m.interaction);
  const reply = m.replies[0]!;
  assert.equal(reply.flags, MessageFlags.Ephemeral);
  const json = JSON.stringify(reply.components?.map((c) => c.toJSON()));
  const url = /"url":"([^"]+)"/.exec(json)?.[1];
  assert.ok(url?.startsWith(`${BASE}/auth/link?t=`), url);
  assert.equal(link.peekLoginLink(new URL(url!).searchParams.get("t")), MOD);
});

test("/dashboard ลงทะเบียนในรายการคำสั่งแล้ว", async () => {
  const { commands } = await import("../src/commands/index.js");
  assert.ok(commands.has("dashboard"));
});
