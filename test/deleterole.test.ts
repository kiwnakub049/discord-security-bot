/**
 * ทดสอบตรรกะความปลอดภัยของ /deleterole (canDelete)
 * — กันลบ @everyone / role ระบบ / role ที่บอทอยู่ต่ำกว่า / บอทไม่มีสิทธิ์
 * ไม่ต้องต่อ Discord จริง ใช้ guild/role ปลอมเท่าที่ canDelete อ่าน
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { canDelete } from "../src/commands/deleterole.js";

const GUILD_ID = "g100";

function fakeGuild(opts: { botTopPos?: number; botPerms?: bigint } = {}) {
  const { botTopPos = 100, botPerms = PermissionFlagsBits.ManageRoles } = opts;
  return {
    id: GUILD_ID,
    members: {
      me: {
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

function fakeRole(opts: {
  id?: string;
  name?: string;
  position?: number;
  managed?: boolean;
}) {
  return {
    id: opts.id ?? "r1",
    name: opts.name ?? "Member",
    position: opts.position ?? 50,
    managed: opts.managed ?? false,
  } as never;
}

test("ลบ role ปกติที่บอทอยู่สูงกว่า -> ok", () => {
  const r = canDelete(fakeGuild({ botTopPos: 100 }), fakeRole({ position: 50 }));
  assert.equal(r.ok, true);
});

test("ลบ @everyone (id = guild id) -> ไม่ได้", () => {
  const r = canDelete(fakeGuild(), fakeRole({ id: GUILD_ID }));
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /everyone/);
});

test("role ที่ระบบจัดการ (managed) -> ไม่ได้", () => {
  const r = canDelete(fakeGuild(), fakeRole({ managed: true }));
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /ระบบจัดการ/);
});

test("role อยู่สูงกว่าหรือเท่ากับบอท -> ไม่ได้", () => {
  const eq = canDelete(fakeGuild({ botTopPos: 50 }), fakeRole({ position: 50 }));
  assert.equal(eq.ok, false, "เท่ากันก็ลบไม่ได้");
  const above = canDelete(fakeGuild({ botTopPos: 50 }), fakeRole({ position: 80 }));
  assert.equal(above.ok, false, "สูงกว่าบอทลบไม่ได้");
});

test("บอทไม่มีสิทธิ์ Manage Roles -> ไม่ได้", () => {
  const r = canDelete(
    fakeGuild({ botPerms: 0n, botTopPos: 100 }),
    fakeRole({ position: 50 }),
  );
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /Manage Roles/);
});

test("บอทเป็น Administrator -> ผ่านด่านสิทธิ์ (แต่ยังต้องอยู่สูงกว่า)", () => {
  const r = canDelete(
    fakeGuild({ botPerms: PermissionFlagsBits.Administrator, botTopPos: 100 }),
    fakeRole({ position: 50 }),
  );
  assert.equal(r.ok, true);
});
