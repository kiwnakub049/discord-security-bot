/**
 * ทดสอบการตรวจว่า "ให้ role บัตรได้จริงไหม"
 *
 * เคสที่ทำให้เขียนเทสนี้: บอทมีสิทธิ์ Administrator ครบ แต่ role ของบอทถูกวางไว้
 * ลำดับล่างสุดของเซิร์ฟเวอร์ Discord จึงปฏิเสธการใส่ role บัตร (403 Missing Permissions)
 * ทั้งที่ permission ผ่านหมด — ถ้าเช็คแค่ permission จะรายงานว่า "ปกติดี" ทั้งที่ใช้งานไม่ได้
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { checkCardRoleSetup } from "../src/modules/cardRole.js";
import { config } from "../src/config.js";

const CARD_ROLE = config.cardRoleId;

/** guild ปลอมที่มีเฉพาะส่วนที่ checkCardRoleSetup อ่านจริง */
function fakeGuild(opts: {
  cardRolePos?: number | null; // null = ไม่มี role นี้ในเซิร์ฟเวอร์
  botTopPos?: number;
  botPerms?: bigint;
}) {
  const { cardRolePos = 59, botTopPos = 200, botPerms = PermissionFlagsBits.Administrator } = opts;
  const cardRole =
    cardRolePos === null
      ? undefined
      : { id: CARD_ROLE, name: "VILLAGER", position: cardRolePos };
  return {
    roles: { cache: { get: (id: string) => (id === CARD_ROLE ? cardRole : undefined) } },
    members: {
      me: {
        // discord.js: Administrator ครอบทุกสิทธิ์ — fake ต้องเลียนแบบ ไม่งั้นเทสจะฟ้องผิดจุด
        permissions: {
          has: (p: bigint) =>
            (botPerms & PermissionFlagsBits.Administrator) ===
              PermissionFlagsBits.Administrator || (botPerms & p) === p,
        },
        roles: { highest: { name: "Undawn", position: botTopPos } },
      },
    },
  } as never;
}

test("role บอทสูงกว่า role บัตร -> ไม่มีปัญหา", () => {
  assert.equal(checkCardRoleSetup(fakeGuild({ botTopPos: 200, cardRolePos: 59 })), null);
});

test("role บอทอยู่ต่ำกว่า -> รายงานปัญหา แม้เป็น Administrator", () => {
  const problem = checkCardRoleSetup(fakeGuild({ botTopPos: 1, cardRolePos: 59 }));
  assert.ok(problem, "ต้องรายงานปัญหา");
  assert.match(problem, /ต่ำกว่า/);
  assert.match(problem, /Undawn/); // บอกชื่อ role ที่ต้องไปลาก
  assert.match(problem, /VILLAGER/);
});

test("ลำดับเท่ากัน -> ยังทำไม่ได้ (Discord ต้องสูงกว่าเท่านั้น)", () => {
  assert.ok(checkCardRoleSetup(fakeGuild({ botTopPos: 59, cardRolePos: 59 })));
});

test("ไม่มีสิทธิ์ Manage Roles -> รายงานปัญหา", () => {
  const problem = checkCardRoleSetup(
    fakeGuild({ botTopPos: 200, botPerms: PermissionFlagsBits.SendMessages }),
  );
  assert.match(problem ?? "", /Manage Roles/);
});

test("role บัตรถูกลบไปแล้ว -> รายงานปัญหา", () => {
  assert.match(checkCardRoleSetup(fakeGuild({ cardRolePos: null })) ?? "", /ไม่พบ role/);
});
