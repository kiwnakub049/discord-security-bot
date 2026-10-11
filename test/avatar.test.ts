/**
 * avatarUrlOf — ลิงก์รูปโปรไฟล์จาก discord.js (ไม่ต่อ Discord จริง: ใช้ client ปลอม)
 * รูปประจำเซิร์ฟมาก่อนรูปบัญชี และ id ที่ไม่ใช่ snowflake ต้องไม่ถูกเอาไปถาม Discord
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { avatarUrlOf } from "../src/web/userNames.js";

const ID = "123456789012345678";

function fakeClient(opts: { member?: boolean; user?: boolean }) {
  const fetched: string[] = [];
  const client = {
    guilds: {
      cache: new Map([
        [
          "g",
          {
            members: {
              cache: new Map(
                opts.member ? [[ID, { displayAvatarURL: () => "https://cdn/guild.webp" }]] : [],
              ),
            },
          },
        ],
      ]),
    },
    users: {
      cache: new Map(),
      fetch: async (id: string) => {
        fetched.push(id);
        if (!opts.user) throw new Error("Unknown User");
        return { username: "u", displayAvatarURL: () => "https://cdn/user.webp" };
      },
    },
  } as unknown as Client;
  return { client, fetched };
}

test("อยู่ในเซิร์ฟ → ใช้รูปประจำเซิร์ฟ ไม่ต้อง fetch", async () => {
  const { client, fetched } = fakeClient({ member: true, user: true });
  assert.equal(await avatarUrlOf(client, ID), "https://cdn/guild.webp");
  assert.equal(fetched.length, 0);
});

test("ไม่อยู่ใน cache ของเซิร์ฟ → fetch บัญชีแล้วใช้รูปบัญชี", async () => {
  const { client } = fakeClient({ user: true });
  assert.equal(await avatarUrlOf(client, ID), "https://cdn/user.webp");
});

test("หาไม่เจอ / ไม่มี client / id แปลก → null และ id แปลกไม่ถูกส่งไปถาม", async () => {
  const { client, fetched } = fakeClient({});
  assert.equal(await avatarUrlOf(client, "999999999999999999"), null);
  assert.equal(await avatarUrlOf(undefined, ID), null);
  assert.equal(await avatarUrlOf(client, "../../etc"), null);
  assert.deepEqual(fetched, ["999999999999999999"]);
});
