/**
 * ตัวกรองแบบติ๊กของหน้า Logs
 * - ฝั่งหน้าเว็บ: ติ๊กหมวด/กิ่ง/ระดับ แล้วได้ค่าตัวกรองและ query ถูก
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
  categoryState,
  filterParams,
  leafChecked,
  matchesFilter,
  parseFilter,
  toggleCategory,
  toggleLeaf,
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

test("ติ๊กหมวด = ทั้งหมวด, ติ๊กซ้ำ = เอาออก", () => {
  const f = toggleCategory(EMPTY_FILTER, "voice");
  assert.deepEqual(f.categories, ["voice"]);
  assert.equal(categoryState(f, "voice"), "all");
  assert.ok(leafChecked(f, "voice", "mic"), "ลูกต้องโชว์ว่าติ๊กด้วย");
  assert.deepEqual(toggleCategory(f, "voice"), EMPTY_FILTER);
});

test("ติ๊กกิ่งเดียว → หมวดขีดกลาง · ติ๊กครบทุกกิ่ง → ยุบเป็นทั้งหมวด", () => {
  let f = toggleLeaf(EMPTY_FILTER, "security", "ai");
  assert.equal(categoryState(f, "security"), "some");
  assert.deepEqual(f.leaves, ["ai"]);
  f = toggleLeaf(f, "security", "warn");
  assert.deepEqual(f.categories, ["security"]);
  assert.deepEqual(f.leaves, []);
});

test("ทั้งหมวดติ๊กอยู่ เอากิ่งออกหนึ่งอัน → เหลือกิ่งอื่นครบ", () => {
  const f = toggleLeaf(toggleCategory(EMPTY_FILTER, "voice"), "voice", "mic");
  assert.deepEqual(f.categories, []);
  assert.deepEqual([...f.leaves].sort(), ["deaf", "move", "room"]);
  assert.equal(categoryState(f, "voice"), "some");
});

test("ติ๊กหมวดที่ติ๊กบางกิ่งอยู่ → เป็นทั้งหมวด กิ่งเก่าถูกล้าง แต่กิ่งหมวดอื่นอยู่ครบ", () => {
  let f = toggleLeaf(EMPTY_FILTER, "voice", "mic");
  f = toggleLeaf(f, "security", "warn");
  f = toggleCategory(f, "voice");
  assert.deepEqual(f.categories, ["voice"]);
  assert.deepEqual(f.leaves, ["warn"]);
});

test("query: หลายหมวด/หลาย event/หลายระดับ ต่อด้วยลูกน้ำ", () => {
  let f = toggleCategory(EMPTY_FILTER, "audit");
  f = toggleLeaf(f, "member", "join-leave");
  f = toggleLevel(toggleLevel(f, "alert"), "warn");
  f = { ...f, window: "24h" };
  const q = new URLSearchParams(filterParams(f, "abc"));
  assert.equal(q.get("category"), "audit");
  assert.equal(q.get("event"), "member_join,member_leave");
  assert.equal(q.get("level"), "alert,warn");
  assert.equal(q.get("window"), "24h");
  assert.equal(q.get("search"), "abc");
  assert.equal(activeCount(f), 5);
  assert.equal(filterParams(EMPTY_FILTER), "");
});

test("log สดผ่านตัวกรองแบบเดียวกับ server", () => {
  const f = toggleLevel(toggleLeaf(toggleCategory(EMPTY_FILTER, "audit"), "voice", "mic"), "alert");
  const e = (category: string, event: string, level: string) =>
    ({ category, event, level }) as Parameters<typeof matchesFilter>[0];
  assert.ok(matchesFilter(e("audit", "audit_ban", "alert"), f));
  assert.ok(matchesFilter(e("voice", "voice_mute_on", "alert"), f));
  assert.ok(!matchesFilter(e("voice", "voice_join", "alert"), f), "กิ่งอื่นในห้องเสียงไม่ได้ติ๊ก");
  assert.ok(!matchesFilter(e("audit", "audit_ban", "info"), f), "ระดับไม่ตรง");
  assert.ok(matchesFilter(e("system", "x", "info"), EMPTY_FILTER));
});

test("parseFilter: ค่าเสีย/กิ่งที่ไม่มีแล้ว ทิ้งไป", () => {
  assert.deepEqual(parseFilter(null), EMPTY_FILTER);
  assert.deepEqual(parseFilter({ category: "voice", leaf: "mic" }), EMPTY_FILTER);
  assert.deepEqual(
    parseFilter({ categories: ["voice", "zzz"], leaves: ["mic", "gone"], levels: ["warn", 1], window: "9y" }),
    { categories: ["voice"], leaves: ["mic"], levels: ["warn"], window: "" },
  );
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
