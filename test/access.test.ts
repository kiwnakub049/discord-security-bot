/**
 * สิทธิ์เข้า dashboard จากยศใน Discord — Administrator เป็น admin เสมอ (กันล็อกตัวเองออก)
 * ไม่ต้องใช้ DB: roleOf อ่านแค่ config กับยศของสมาชิก
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";

type Access = typeof import("../src/auth/access.js");
let roleOf: Access["roleOf"];

before(async () => {
  const { config } = await import("../src/config.js");
  config.dashboard.adminRoleIds = ["900"];
  config.dashboard.modRoleIds = ["800", "801"];
  ({ roleOf } = await import("../src/auth/access.js"));
});

const member = (roles: string[], administrator = false) =>
  ({
    permissions: { has: (p: bigint) => administrator && p === PermissionFlagsBits.Administrator },
    roles: { cache: { has: (id: string) => roles.includes(id) } },
  }) as never;

test("ยศ admin → admin · ยศ mod (ตัวไหนก็ได้) → mod · ไม่มียศ → เข้าไม่ได้", () => {
  assert.equal(roleOf(member(["900"])), "admin");
  assert.equal(roleOf(member(["801"])), "mod");
  assert.equal(roleOf(member(["123"])), null);
  assert.equal(roleOf(member([])), null);
});

test("มีทั้งยศ admin และ mod → admin (สิทธิ์สูงกว่าชนะ)", () => {
  assert.equal(roleOf(member(["800", "900"])), "admin");
});

test("สิทธิ์ Administrator → admin แม้ไม่ได้ตั้งยศไว้", () => {
  assert.equal(roleOf(member([], true)), "admin");
});
