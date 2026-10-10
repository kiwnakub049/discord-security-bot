/**
 * ทดสอบการแปลง id เป็น mention ก่อนส่ง embed เข้า Discord
 *
 * จุดที่พลาดง่าย: การแปลงนี้ต้องเกิด "เฉพาะขาที่ส่งเข้า Discord" เท่านั้น
 * ถ้าเผลอไปแปลงตั้งแต่ตอนบันทึก ค่าที่เก็บใน DB จะกลายเป็น "<#123>"
 * ซึ่งหน้าเว็บวาดออกมาเป็นข้อความดิบอ่านไม่รู้เรื่อง และ CSV ที่ส่งออกก็ใช้ไม่ได้
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionize } from "../src/utils/logger.js";

const CH = "1506607998880186368";
const USER = "789899904201392149";

test("ช่องห้อง: เก็บชื่อเดิมไว้ แล้วต่อ mention ให้กดได้", () => {
  const out = mentionize("ห้อง", `🌸・Sakura Rest (${CH})`);
  assert.equal(out, `🌸・Sakura Rest (<#${CH}>)`);
  // ชื่อ ณ วันเกิดเหตุต้องยังอยู่ — ถ้าห้องถูกเปลี่ยนชื่อทีหลังจะได้เทียบได้
  assert.ok(out.includes("Sakura Rest"));
});

test("ช่อง จาก/ไป ก็เป็นห้องเหมือนกัน", () => {
  for (const name of ["จาก", "ไป", "ห้องเสียง"]) {
    assert.equal(mentionize(name, `ห้องหนึ่ง (${CH})`), `ห้องหนึ่ง (<#${CH}>)`);
  }
});

test("ช่องอื่น: id กลายเป็น mention ของคน", () => {
  assert.equal(
    mentionize("User", `(winterrealcome) ${USER}`),
    `(winterrealcome) <@${USER}>`,
  );
});

test("รายชื่อคนในห้อง: ทุกคนกดได้ ไม่ใช่แค่คนแรก", () => {
  const roster = [`ก (a) ${USER} (เปิดไมค์)`, `ข (b) ${CH} (ปิดไมค์)`].join("\n");
  const out = mentionize("คนในห้องตอนนั้น (2)", roster);
  assert.equal((out.match(/<@\d+>/g) ?? []).length, 2);
});

test("ช่องห้องที่ไม่มี id (log เก่า) ต้องไม่ถูกแตะ", () => {
  const old = "🏡・Village Square";
  assert.equal(mentionize("ห้อง", old), old);
});

test("ตัวเลขที่ไม่ใช่ id ต้องไม่ถูกแปลง", () => {
  // อายุบัญชี จำนวนสมาชิก คะแนน ฯลฯ — สั้นกว่า 17 หลัก
  assert.equal(mentionize("อายุ account", "365 วัน"), "365 วัน");
  assert.equal(mentionize("คะแนน", "0.94"), "0.94");
  assert.equal(mentionize("สมาชิกทั้งหมด", "45387"), "45387");
});

test("id ในช่องห้องที่ไม่ได้อยู่ท้ายสุด ไม่ถูกแปลงเป็นห้อง", () => {
  // กันกรณีชื่อห้องมีตัวเลขยาวปนอยู่กลางข้อความ
  const v = `ห้อง ${CH} ของใครสักคน`;
  assert.equal(mentionize("ห้อง", v), v);
});
