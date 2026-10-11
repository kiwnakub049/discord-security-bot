/**
 * ตัวกรองแบบติ๊กของหน้า Logs
 * - ฝั่งหน้าเว็บ: เลือกหมวด + ติ๊กหัวข้อย่อย/ระดับ แล้วได้ค่าตัวกรองและ query ถูก
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
  leavesOf,
  matchesFilter,
  parseFilter,
  pickCategory,
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

test("เปลี่ยนหมวด → หัวข้อย่อยของหมวดเก่าถูกล้าง ระดับ/เวลาคงไว้", () => {
  let f = pickCategory(EMPTY_FILTER, "voice");
  f = toggleLeaf(toggleLevel(f, "alert"), "mic");
  f = { ...f, window: "7d" };
  const g = pickCategory(f, "audit");
  assert.deepEqual(g, { category: "audit", leaves: [], levels: ["alert"], window: "7d" });
  assert.deepEqual(leavesOf("").length, 0, "ทุกหมวด = ไม่มีหัวข้อย่อยให้ติ๊ก");
  assert.deepEqual(leavesOf("system").length, 0);
});

test("query: ไม่ติ๊กหัวข้อย่อย → ส่งหมวด · ติ๊ก → ส่งแค่ event", () => {
  let f = pickCategory(EMPTY_FILTER, "member");
  assert.equal(new URLSearchParams(filterParams(f)).get("category"), "member");

  f = toggleLeaf(f, "join-leave");
  f = toggleLevel(toggleLevel(f, "alert"), "warn");
  f = { ...f, window: "24h" };
  const q = new URLSearchParams(filterParams(f, "abc"));
  assert.equal(q.get("category"), null);
  assert.equal(q.get("event"), "member_join,member_leave");
  assert.equal(q.get("level"), "alert,warn");
  assert.equal(q.get("window"), "24h");
  assert.equal(q.get("search"), "abc");
  assert.equal(activeCount(f), 4, "หมวดไม่นับในตัวกรอง");
  assert.equal(filterParams(EMPTY_FILTER), "");
});

test("log สดผ่านตัวกรองแบบเดียวกับ server", () => {
  const e = (category: string, event: string, level: string) =>
    ({ category, event, level }) as Parameters<typeof matchesFilter>[0];
  const voice = pickCategory(EMPTY_FILTER, "voice");
  assert.ok(matchesFilter(e("voice", "voice_join", "info"), voice));
  assert.ok(!matchesFilter(e("audit", "audit_ban", "info"), voice));

  const mic = toggleLevel(toggleLeaf(voice, "mic"), "warn");
  assert.ok(matchesFilter(e("voice", "voice_mute_on", "warn"), mic));
  assert.ok(!matchesFilter(e("voice", "voice_join", "warn"), mic), "หัวข้อย่อยอื่นไม่ได้ติ๊ก");
  assert.ok(!matchesFilter(e("voice", "voice_mute_on", "info"), mic), "ระดับไม่ตรง");
  assert.ok(matchesFilter(e("system", "x", "info"), EMPTY_FILTER));
});

test("parseFilter: ค่าเสีย/ของเวอร์ชันเก่า/หัวข้อย่อยต่างหมวด ทิ้งไป", () => {
  assert.deepEqual(parseFilter(null), EMPTY_FILTER);
  assert.deepEqual(parseFilter({ categories: ["voice"], leaves: ["mic"] }), EMPTY_FILTER);
  assert.deepEqual(
    parseFilter({ category: "voice", leaves: ["mic", "warn", "gone"], levels: ["warn", 1], window: "9y" }),
    { category: "voice", leaves: ["mic"], levels: ["warn"], window: "" },
  );
  assert.deepEqual(parseFilter({ category: "zzz" }).category, "");
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
