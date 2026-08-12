/**
 * ทดสอบ loginWithRetry — ตัวกันอาการ "systemd บอก active แต่บอทไม่ได้ต่อ Discord"
 * ใส่ sleep ปลอมเข้าไป เทสต์เลยไม่ต้องรอจริงสักมิลลิวินาที
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPermanentLoginError,
  loginWithRetry,
} from "../src/utils/loginRetry.js";

/** เก็บว่าถูกสั่งรอกี่มิลลิวินาทีบ้าง แทนที่จะรอจริง */
function fakeSleep(): { delays: number[]; sleep: (ms: number) => Promise<void> } {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

test("สำเร็จตั้งแต่ครั้งแรก = ไม่หน่วงเลย", async () => {
  const { delays, sleep } = fakeSleep();
  let calls = 0;
  const r = await loginWithRetry(
    () => {
      calls++;
      return Promise.resolve("ok");
    },
    { sleep },
  );
  assert.equal(r, "ok");
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("พังชั่วคราวแล้วหายเอง = ลองต่อจนสำเร็จ", async () => {
  const { sleep } = fakeSleep();
  let calls = 0;
  const r = await loginWithRetry(
    () => {
      calls++;
      // จำลอง DNS ยังไม่พร้อมตอนบูต แล้วพร้อมในครั้งที่ 3
      if (calls < 3) return Promise.reject(new Error("EAI_AGAIN discord.com"));
      return Promise.resolve("ok");
    },
    { sleep },
  );
  assert.equal(r, "ok");
  assert.equal(calls, 3);
});

test("หน่วงเพิ่มทีละเท่าตัว", async () => {
  const { delays, sleep } = fakeSleep();
  await assert.rejects(
    loginWithRetry(() => Promise.reject(new Error("เน็ตล่ม")), {
      attempts: 4,
      baseDelayMs: 1000,
      sleep,
    }),
  );
  // ครั้งสุดท้ายไม่หน่วงต่อ เพราะไม่มีรอบถัดไปแล้ว
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test("พังทุกครั้ง = โยน error ตัวสุดท้ายออกมา ไม่ใช่กลืนเงียบ", async () => {
  const { sleep } = fakeSleep();
  await assert.rejects(
    loginWithRetry(() => Promise.reject(new Error("ครั้งสุดท้าย")), {
      attempts: 2,
      sleep,
    }),
    /ครั้งสุดท้าย/,
  );
});

test("โทเคนผิด = เลิกทันที ไม่ลองซ้ำให้เสียเวลา", async () => {
  const { delays, sleep } = fakeSleep();
  let calls = 0;
  const err = Object.assign(new Error("An invalid token was provided."), {
    code: "TokenInvalid",
  });
  await assert.rejects(
    loginWithRetry(
      () => {
        calls++;
        return Promise.reject(err);
      },
      { attempts: 5, sleep, shouldRetry: (e) => !isPermanentLoginError(e) },
    ),
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("แยกออกว่าอันไหนพังถาวร อันไหนแค่ชั่วคราว", () => {
  // สองอันนี้ยืนยันด้วยการยิงจริงกับ discord.js แล้ว ไม่ได้เดาเอาจากเอกสาร
  assert.equal(isPermanentLoginError({ code: "TokenInvalid" }), true);
  assert.equal(isPermanentLoginError({ code: "UND_ERR_INVALID_ARG" }), true);
  assert.equal(isPermanentLoginError({ status: 401 }), true);
  assert.equal(
    isPermanentLoginError(new Error("An invalid token was provided.")),
    true,
  );
  assert.equal(
    isPermanentLoginError(new Error("invalid Authorization header")),
    true,
  );
  assert.equal(
    isPermanentLoginError(new Error("getaddrinfo EAI_AGAIN discord.com")),
    false,
  );
  assert.equal(isPermanentLoginError(undefined), false);
});
