/**
 * ทดสอบทะเบียนบอทพาร์ทเนอร์
 *
 * ตรรกะนี้ตัดสินว่า log การแบนจะไปอยู่หมวดไหน ถ้าจับ id ผิดพลาด
 * การกระทำของบอทจะปนกลับเข้าหมวดของ mod คนจริง (หรือกลับกัน) ซึ่งเป็นเรื่องที่
 * มองไม่เห็นจนกว่าจะมีคนไล่ดู log ย้อนหลังแล้วสรุปผิด
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PARTNER_BOTS,
  partnerById,
  partnerFromActor,
  partnerLabel,
} from "../src/partners.js";

const KILL_SWITCH = "1292549208846372875";

test("Kill Switch อยู่ในทะเบียน", () => {
  const bot = partnerById(KILL_SWITCH);
  assert.ok(bot, "ต้องหาเจอ");
  assert.equal(bot.name, "Kill Switch");
  assert.ok(bot.role.length > 0, "ต้องมีคำอธิบายว่าทำอะไร");
});

test("id ที่ไม่อยู่ในทะเบียน = ไม่ใช่พาร์ทเนอร์", () => {
  for (const v of ["789899904201392149", "0", "", null, undefined]) {
    assert.equal(partnerById(v), null, `${JSON.stringify(v)} ไม่ควรตรง`);
  }
});

test("partnerFromActor อ่านได้ทั้งแบบมีชื่อและแบบเหลือแต่ id", () => {
  // สองรูปแบบนี้มาจริงทั้งคู่ — แล้วแต่ว่าตอนบันทึก Discord resolve ชื่อได้ไหม
  assert.equal(partnerFromActor(KILL_SWITCH)?.name, "Kill Switch");
  assert.equal(partnerFromActor(`bot#0001 (${KILL_SWITCH})`)?.name, "Kill Switch");
  assert.equal(partnerFromActor(`Kill Switch (${KILL_SWITCH})`)?.name, "Kill Switch");
  assert.equal(partnerFromActor(` ${KILL_SWITCH} `)?.name, "Kill Switch", "ช่องว่างหัวท้ายต้องไม่ทำให้พลาด");
});

test("คนธรรมดาที่ชื่อมีตัวเลข ต้องไม่ถูกนับเป็นพาร์ทเนอร์", () => {
  assert.equal(partnerFromActor("winterrealcome (789899904201392149)"), null);
  assert.equal(partnerFromActor("flick"), null);
  assert.equal(partnerFromActor("ไม่ทราบ"), null);
});

test("id ของพาร์ทเนอร์ที่โผล่ใน 'เป้าหมาย' ต้องไม่ทำให้จับผิดตัว", () => {
  // ถ้าวันหนึ่งมีคนสั่งแบนตัวบอทเอง ผู้ทำคือคน ไม่ใช่บอท
  // regex จับเฉพาะวงเล็บ "ท้ายสุด" ของค่านั้น ๆ ซึ่งเป็น id ของผู้ทำเสมอ
  assert.equal(partnerFromActor("flick (999)"), null);
  assert.equal(
    partnerFromActor(`ชื่อที่มี ${KILL_SWITCH} อยู่กลางข้อความ (999)`),
    null,
    "id ที่อยู่กลางข้อความต้องไม่นับ",
  );
});

test("partnerLabel เก็บ id ไว้ด้วย เพื่อตรวจย้อนหลังได้", () => {
  const bot = partnerById(KILL_SWITCH)!;
  const label = partnerLabel(bot);
  assert.equal(label, `Kill Switch (${KILL_SWITCH})`);
  // สำคัญ: ป้ายที่สร้างแล้วต้องยังอ่านกลับเป็นบอทตัวเดิมได้
  // ไม่งั้นสคริปต์ย้ายข้อมูลจะย้ายซ้ำทุกครั้งที่รัน
  assert.equal(partnerFromActor(label)?.id, KILL_SWITCH);
});

test("ทุกตัวในทะเบียนมี id เป็นตัวเลขล้วนและไม่ซ้ำกัน", () => {
  const ids = new Set<string>();
  for (const bot of PARTNER_BOTS) {
    assert.match(bot.id, /^\d{17,20}$/, `${bot.name}: id ต้องเป็น snowflake ของ Discord`);
    assert.ok(!ids.has(bot.id), `${bot.name}: id ซ้ำกับตัวอื่น`);
    ids.add(bot.id);
    assert.ok(bot.name.trim().length > 0);
  }
});
