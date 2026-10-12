/**
 * ปุ่ม "ลบข้อความ" บนการ์ด AI spam — ลบตาม ref, ข้อความที่หายไปแล้วไม่นับว่าพัง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DiscordAPIError, type Client } from "discord.js";
import { deleteMessageRefs } from "../src/modules/deleteRefs.js";

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError({ code, message: "x" }, code, 404, "DELETE", "/x", {});
}

/** client ปลอม: ห้อง c1 ลบได้ (ยกเว้น m-gone = หายแล้ว, m-perm = ไม่มีสิทธิ์), ห้อง c-gone ไม่มีแล้ว */
function mockClient() {
  const deleted: string[] = [];
  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      delete: async (id: string) => {
        if (id === "m-gone") throw apiError(10008);
        if (id === "m-perm") throw apiError(50013);
        deleted.push(id);
      },
    },
  };
  const client = {
    channels: {
      fetch: async (id: string) => {
        if (id === "c-gone") throw apiError(10003);
        return channel;
      },
    },
  } as unknown as Client;
  return { client, deleted };
}

test("deleteMessageRefs: ลบได้ / หายไปแล้ว / ห้องหาย นับแยกถูก", async () => {
  const { client, deleted } = mockClient();
  const r = await deleteMessageRefs(client, ["c1/m1", "c1/m2", "c1/m-gone", "c-gone/m3", "เสีย"]);
  assert.deepEqual(deleted, ["m1", "m2"]);
  assert.deepEqual(r, { deleted: 2, gone: 2, failed: 0 });
});

test("deleteMessageRefs: ไม่มีสิทธิ์ลบ → failed (route จะไม่ปิดเรื่อง)", async () => {
  const { client } = mockClient();
  const r = await deleteMessageRefs(client, ["c1/m-perm", "c1/m4"]);
  assert.deepEqual(r, { deleted: 1, gone: 0, failed: 1 });
});
