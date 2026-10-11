/**
 * ตัวกรองของหน้า Logs (ต้นไม้หมวด + ติ๊กระดับ)
 * - ฝั่งหน้าเว็บ: เลือกหมวด/กิ่งจากต้นไม้ + ติ๊กระดับ แล้วได้ค่าตัวกรองและ query ถูก
 * - ฝั่ง server: หลายหมวด/หลายระดับ และ "หมวด หรือ event" กรองใน SQL ถูก
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_FILTER,
  activeCount,
  filterParams,
  matchesFilter,
  parseFilter,
  toggleLevel,
} from "../src/web/ui/src/lib/logTree.js";

const DB_PATH = join(tmpdir(), "bot-test-logfilter.db");
process.env.BOT_DB_PATH = DB_PATH;

type Store = typeof import("../src/store/logStore.js");
let store: Store;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  const { initDb } = await import("../src/store/db.js");
  initDb();
  store = await import("../src/store/logStore.js");
});

test("query: เลือกแค่หมวด → ส่งหมวด · เลือกกิ่ง → ส่งแค่ event ของกิ่ง", () => {
  const cat = { ...EMPTY_FILTER, category: "member" as const };
  assert.equal(new URLSearchParams(filterParams(cat)).get("category"), "member");

  let f = { ...cat, leaf: "join-leave" };
  f = toggleLevel(toggleLevel(f, "alert"), "warn");
  f = { ...f, window: "24h" };
  const q = new URLSearchParams(filterParams(f, "abc"));
  assert.equal(q.get("category"), null);
  assert.equal(q.get("event"), "member_join,member_leave");
  assert.equal(q.get("level"), "alert,warn");
  assert.equal(q.get("window"), "24h");
  assert.equal(q.get("search"), "abc");
  assert.equal(activeCount(f), 3, "หมวด/กิ่งไม่นับ — อยู่ในต้นไม้");
  assert.equal(filterParams(EMPTY_FILTER), "");
});

test("ติ๊กระดับซ้ำ = เอาออก", () => {
  const f = toggleLevel(EMPTY_FILTER, "warn");
  assert.deepEqual(f.levels, ["warn"]);
  assert.deepEqual(toggleLevel(f, "warn").levels, []);
});

test("log สดผ่านตัวกรองแบบเดียวกับ server", () => {
  const e = (category: string, event: string, level: string) =>
    ({ category, event, level }) as Parameters<typeof matchesFilter>[0];
  const voice = { ...EMPTY_FILTER, category: "voice" as const };
  assert.ok(matchesFilter(e("voice", "voice_join", "info"), voice));
  assert.ok(!matchesFilter(e("audit", "audit_ban", "info"), voice));

  const mic = toggleLevel({ ...voice, leaf: "mic" }, "warn");
  assert.ok(matchesFilter(e("voice", "voice_mute_on", "warn"), mic));
  assert.ok(!matchesFilter(e("voice", "voice_join", "warn"), mic), "กิ่งอื่น");
  assert.ok(!matchesFilter(e("voice", "voice_mute_on", "info"), mic), "ระดับไม่ตรง");
  assert.ok(matchesFilter(e("system", "x", "info"), EMPTY_FILTER));
});

test("parseFilter: ค่าเสีย/กิ่งต่างหมวด/กิ่งที่ไม่มีแล้ว ทิ้งไป", () => {
  assert.deepEqual(parseFilter(null), EMPTY_FILTER);
  assert.deepEqual(
    parseFilter({ category: "voice", leaf: "mic", levels: ["warn", 1], window: "9y" }),
    { category: "voice", leaf: "mic", levels: ["warn"], window: "" },
  );
  assert.equal(parseFilter({ category: "voice", leaf: "warn" }).leaf, "", "warn เป็นกิ่งของหมวดอื่น");
  assert.equal(parseFilter({ category: "zzz" }).category, "");
});

test("getLogs: หลายระดับ + (หมวด หรือ event)", async () => {
  const add = (category: "audit" | "voice" | "system", event: string, level: "info" | "warn" | "alert") =>
    store.addLog(level, category, event, `${event}-${level}`);
  await add("audit", "audit_ban", "alert");
  await add("audit", "audit_role", "info");
  await add("voice", "voice_mute_on", "warn");
  await add("voice", "voice_join", "info");
  await add("system", "system_login", "info");

  const titles = (o: Parameters<Store["getLogs"]>[0]) =>
    store.getLogs(o).map((e) => e.title).sort();

  assert.deepEqual(titles({ categories: ["audit"], events: ["voice_mute_on"] }), [
    "audit_ban-alert",
    "audit_role-info",
    "voice_mute_on-warn",
  ]);
  assert.deepEqual(titles({ categories: ["audit"], events: ["voice_mute_on"], levels: ["alert", "warn"] }), [
    "audit_ban-alert",
    "voice_mute_on-warn",
  ]);
  assert.deepEqual(titles({ categories: ["voice", "system"], levels: ["info"] }), [
    "system_login-info",
    "voice_join-info",
  ]);
  // ของเดิม (ค่าเดียว) ยังใช้ได้ — overview/ผู้ช่วยเรียกแบบนี้
  assert.deepEqual(titles({ level: "alert" }), ["audit_ban-alert"]);
});
