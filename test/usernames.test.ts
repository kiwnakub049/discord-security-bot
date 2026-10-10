/**
 * ทดสอบ resolveNames — กันหน้าสมาชิกหมุนค้างจาก users.fetch ที่ไม่มี timeout
 *  - อ่านจาก cache ของ discord.js ก่อน (ไม่ fetch)
 *  - คนที่ fetch พัง (reject) ถูกข้าม ไม่ทำให้ทั้งชุดค้าง
 *  - จำ "หาไม่เจอ" กันยิงซ้ำรอบถัดไป
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNames } from "../src/web/userNames.js";

function fakeClient(opts: {
  cache?: Record<string, string>; // id -> username ที่อยู่ใน cache แล้ว
  fetchable?: Record<string, string>; // id -> username ที่ fetch สำเร็จ
  onFetch?: (id: string) => void;
}) {
  const cache = new Map(Object.entries(opts.cache ?? {}));
  return {
    users: {
      cache: { get: (id: string) => (cache.has(id) ? { username: cache.get(id) } : undefined) },
      fetch: async (id: string) => {
        opts.onFetch?.(id);
        const name = opts.fetchable?.[id];
        if (name === undefined) throw new Error("Unknown User");
        return { username: name };
      },
    },
  } as never;
}

test("อ่านจาก cache ก่อน — ไม่ fetch ซ้ำ", async () => {
  let fetched = false;
  const client = fakeClient({
    cache: { a: "Alice" },
    onFetch: () => (fetched = true),
  });
  const out = await resolveNames(client, ["a"]);
  assert.equal(out.a, "Alice");
  assert.equal(fetched, false, "id ที่อยู่ใน cache ต้องไม่ยิง fetch");
});

test("คน fetch พัง ถูกข้าม ไม่ทำให้ทั้งชุดค้าง (คนอื่นยังได้ชื่อ)", async () => {
  const client = fakeClient({ fetchable: { good: "Bob" } }); // "bad" ไม่มี → reject
  const out = await resolveNames(client, ["good", "bad"]);
  assert.equal(out.good, "Bob");
  assert.equal(out.bad, undefined, "คนที่ fetch พังต้องไม่มีคีย์ (ผู้เรียก fallback เป็น id)");
});

test("จำ 'หาไม่เจอ' — รอบถัดไปไม่ยิง fetch ซ้ำ", async () => {
  const calls: string[] = [];
  const client = fakeClient({ onFetch: (id) => calls.push(id) });
  await resolveNames(client, ["ghost"]); // reject → จำเป็น miss
  await resolveNames(client, ["ghost"]); // ต้องไม่ยิงซ้ำ
  assert.equal(calls.filter((c) => c === "ghost").length, 1, "ยิง fetch แค่ครั้งเดียว");
});

test("client ไม่มี (undefined) → คืน object ว่าง ไม่ throw", async () => {
  const out = await resolveNames(undefined, ["x"]);
  assert.deepEqual(out, {});
});
