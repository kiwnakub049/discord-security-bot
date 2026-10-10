/**
 * ทดสอบการอ่านรายชื่อผู้เล่นจากไฟล์ที่ปลั๊กอิน Lua เขียน
 *
 * เหตุที่ต้องมี: Lua เข้ารหัสตารางว่างเป็น {} แต่ตารางที่มีสมาชิกเป็น []
 * ถ้าฝั่ง Node รับแค่แบบเดียว จะโชว์ "0 คน" ทั้งที่มีคนเล่นอยู่ ซึ่งเป็นอาการที่
 * ดูไม่ออกว่าผิด เพราะเซิร์ฟก็ยังทำงานปกติ
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "beammp-sup-"));
mkdirSync(join(dir, "Resources", "Server", "UndawnStatus"), { recursive: true });
process.env.BEAMMP_DIR = dir;

const { paths } = await import("../src/beammp/paths.js");
const { Supervisor } = await import("../src/beammp/supervisor.js");

/** ยัดสถานะ running เข้าไปตรง ๆ — ไม่ต้องรันเซิร์ฟจริงเพื่อทดสอบการแปลงข้อมูล */
function running(sup: object): void {
  (sup as { state: string }).state = "running";
}

function writeStatus(payload: unknown): void {
  writeFileSync(paths.status, JSON.stringify(payload));
}

test("ตารางว่างที่ Lua เขียนเป็น {} -> อ่านได้เป็น 0 คน ไม่พัง", () => {
  const sup = new Supervisor();
  running(sup);
  writeStatus({ at: Math.floor(Date.now() / 1000), count: 0, players: {} });
  const r = sup.players();
  assert.deepEqual(r, { count: 0, players: [], stale: false });
});

test("รายชื่อแบบ array อ่านได้ครบ", () => {
  const sup = new Supervisor();
  running(sup);
  const players = [
    { id: 0, name: "flick", guest: false, cars: 2 },
    { id: 1, name: "tan", guest: true, cars: 1 },
  ];
  writeStatus({ at: Math.floor(Date.now() / 1000), count: 2, players });
  assert.deepEqual(sup.players(), { count: 2, players, stale: false });
});

test("รายชื่อที่ Lua เขียนเป็น object (คีย์ 1..n) ก็ต้องอ่านได้", () => {
  const sup = new Supervisor();
  running(sup);
  writeStatus({
    at: Math.floor(Date.now() / 1000),
    count: 2,
    players: {
      "1": { id: 0, name: "flick", guest: false, cars: 2 },
      "2": { id: 1, name: "tan", guest: true, cars: 1 },
    },
  });
  const r = sup.players();
  assert.equal(r?.count, 2);
  assert.equal(r?.players.length, 2, "ต้องไม่กลายเป็น 0 คน");
});

test("ไฟล์เก่าเกิน 15 วิ -> ติดป้ายว่าข้อมูลค้าง", () => {
  const sup = new Supervisor();
  running(sup);
  writeStatus({
    at: Math.floor(Date.now() / 1000) - 60,
    count: 3,
    players: [],
  });
  assert.equal(sup.players()?.stale, true);
});

test("ไฟล์เสีย -> คืน null ไม่โยน error", () => {
  const sup = new Supervisor();
  running(sup);
  writeFileSync(paths.status, "{ ไม่ใช่ json");
  assert.equal(sup.players(), null);
});

test("เซิร์ฟไม่ได้รัน -> ไม่รายงานผู้เล่นค้างจากไฟล์เก่า", () => {
  const sup = new Supervisor(); // state = stopped
  writeStatus({ at: Math.floor(Date.now() / 1000), count: 5, players: [] });
  assert.equal(sup.players(), null);
});
