/**
 * การ์ด "Claude จับข้อความ" บนหน้าแรก: ปุ่มเตือน/timeout/ปล่อยผ่าน + หมายเหตุ
 * → ลงโทษจริง, ถูก/ผิดย้อนไปติดที่ log ต้นทาง, หมายเหตุไปเป็นเหตุผล
 * server จริง + client Discord ปลอม (เท่าที่ route ใช้) · DB ชั่วคราวใน tmp
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

console.log = () => {};
process.env.BOT_DB_PATH = join(mkdtempSync(join(tmpdir(), "botqclaude-")), "test.db");
process.env.SESSION_SECRET ||= "test-secret-do-not-use-in-prod";
const PORT = 3872;
const BASE = `http://127.0.0.1:${PORT}`;
const MOD = "222222222222222222";
const TARGET = "555555555555555555";
const GONE = "666666666666666666";

const calls = { timeout: [] as (number | null)[], dm: [] as string[] };
const member = {
  id: TARGET,
  user: { bot: false, tag: "target#0", id: TARGET },
  guild: { id: "g1", name: "TestGuild" },
  roles: { cache: [] },
  permissions: { has: () => false },
  moderatable: true,
  timeout: async (ms: number | null) => void calls.timeout.push(ms),
  send: async (m: unknown) => void calls.dm.push(JSON.stringify(m)),
};
const guild = {
  id: "g1",
  name: "TestGuild",
  members: {
    fetch: async (id: string) => {
      if (id === TARGET) return member;
      throw new Error("Unknown Member");
    },
  },
};
const client = {
  guilds: { cache: { get: () => guild, first: () => guild } },
  channels: { fetch: async () => null },
  users: { fetch: async () => { throw new Error("no"); } },
} as never;

let server: Server;
let cookie = "";
type Store = typeof import("../src/store/queueStore.js");
let store: Store;
let addLog: typeof import("../src/store/logStore.js").addLog;
let verdicts: typeof import("../src/store/aiVerdictStore.js");
let warnings: typeof import("../src/modules/warningStore.js");

before(async () => {
  const { initDb } = await import("../src/store/db.js");
  initDb();
  const { config } = await import("../src/config.js");
  config.web.port = PORT;
  config.web.host = "127.0.0.1";
  const { createSession } = await import("../src/auth/session.js");
  const { COOKIE_NAME } = await import("../src/web/middleware/auth.js");
  cookie = `${COOKIE_NAME}=${createSession(MOD)}`;
  store = await import("../src/store/queueStore.js");
  ({ addLog } = await import("../src/store/logStore.js"));
  verdicts = await import("../src/store/aiVerdictStore.js");
  warnings = await import("../src/modules/warningStore.js");
  const { startWebServer } = await import("../src/web/server.js");
  server = startWebServer(client, { access: async (id) => (id === MOD ? { role: "mod", name: "mod_user" } : null) });
  await new Promise((r) => setTimeout(r, 300));
});

after(() => server?.close());

const resolveItem = (id: number, outcome: string, note?: string) =>
  fetch(`${BASE}/api/queue/${id}/resolve`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/json" },
    body: JSON.stringify({ outcome, ...(note !== undefined ? { note } : {}) }),
  });

/** log + การ์ดแบบที่ aiMod สร้าง */
async function detection(userId: string, text: string) {
  const log = await addLog("warn", "security", "security_ai", "Claude สงสัยว่าไม่สุภาพ — ลง log ไว้ (ไม่ได้ลบ)", [
    { name: "User", value: `u#0 (${userId})` },
    { name: "คะแนน", value: "0.6500" },
    { name: "ข้อความ", value: text },
    { name: "ลบข้อความ", value: "ไม่ได้ลบ" },
  ]);
  return { logId: log.id, id: store.enqueue({ category: "ai-toxic", subjectId: userId, title: "u#0", logId: log.id }) };
}

test("หมวดโผล่ใน /api/queue พร้อมช่องหมายเหตุ + จำนวนครั้งที่รวมอยู่", async () => {
  const a = await detection(TARGET, "ข้อความแรก");
  const b = await detection(TARGET, "ข้อความสอง");
  assert.equal(a.id, b.id, "คนเดิม = การ์ดใบเดียว");
  const q = await (await fetch(`${BASE}/api/queue`, { headers: { Cookie: cookie } })).json();
  const stack = q.stacks.find((s: { key: string }) => s.key === "ai-toxic");
  assert.equal(stack.note, true);
  assert.equal(stack.items[0].hits, 2);
  assert.deepEqual(
    stack.outcomes.map((o: { key: string }) => o.key),
    ["ban", "timeout", "warn", "clear"],
  );
});

test("เตือน + หมายเหตุ → เตือนจริง (เหตุผล = หมายเหตุ) · ทุก log ต้นทางได้คำตัดสิน 'ถูก'", async () => {
  const item = store.listOpen("ai-toxic").find((x) => x.subject_id === TARGET)!;
  const r = await resolveItem(item.id, "warn", "  ด่าเพื่อนแรง  ");
  assert.equal(r.status, 200, await r.clone().text());
  assert.match((await r.json()).message, /เตือนแล้ว \(ครั้งที่ 1/);
  const w = warnings.getWarnings(TARGET);
  assert.equal(w.length, 1);
  assert.equal(w[0]!.reason, "ด่าเพื่อนแรง");
  const row = store.getItem(item.id)!;
  assert.equal(row.outcome, "warn");
  assert.equal(row.note, "ด่าเพื่อนแรง");
  const map = verdicts.getVerdictMap();
  for (const logId of store.itemLogIds(row)) assert.equal(map[logId], "toxic");
  assert.equal(Object.values(verdicts.getVerdictComments()).filter((c) => c === "ด่าเพื่อนแรง").length, 2);
});

test("timeout → member.timeout 1 ชม.", async () => {
  const { id } = await detection(TARGET, "อีกรอบ");
  const r = await resolveItem(id, "timeout");
  assert.equal(r.status, 200);
  assert.equal(calls.timeout.at(-1), 60 * 60_000);
});

test("ปล่อยผ่าน → คำตัดสิน 'ผิด' ไม่ลงโทษ", async () => {
  const before = warnings.getWarnings(TARGET).length;
  const { id, logId } = await detection(TARGET, "พูดเล่น");
  const r = await resolveItem(id, "clear", "เพื่อนกัน");
  assert.equal(r.status, 200);
  assert.equal(verdicts.getVerdictMap()[logId], "ok");
  assert.equal(warnings.getWarnings(TARGET).length, before);
});

test("สมาชิกออกไปแล้ว → เตือนไม่ได้ การ์ดยังค้างให้กดอย่างอื่น", async () => {
  const { id } = await detection(GONE, "x");
  const r = await resolveItem(id, "warn");
  assert.equal(r.status, 404);
  assert.equal(store.getItem(id)!.resolved_at, null);
  assert.equal((await resolveItem(id, "clear")).status, 200);
});

test("หมวดที่ไม่มีช่องหมายเหตุ → หมายเหตุถูกทิ้ง", async () => {
  const id = store.enqueue({ category: "admin-ticket", subjectId: "777777777777777777", title: "t" });
  await resolveItem(id, "done", "ไม่ควรเก็บ");
  assert.equal(store.getItem(id)!.note, null);
});
