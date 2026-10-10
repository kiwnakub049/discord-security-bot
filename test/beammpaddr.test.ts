/**
 * ทดสอบการแยกชนิดที่อยู่เครือข่าย
 *
 * ที่อยู่เหล่านี้ถูกเอาไปโชว์ในดิสคอร์ดให้คนก็อปไปเข้าเซิร์ฟ ถ้าแยก LAN กับ Tailscale
 * ผิด คนจะได้ที่อยู่ที่ตัวเองเข้าไม่ถึงแล้วคิดว่าเซิร์ฟพัง
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinAddresses } from "../src/beammp/addresses.js";

test("อ่านที่อยู่ของเครื่องได้โดยไม่โยน error", () => {
  const addrs = joinAddresses();
  assert.ok(Array.isArray(addrs));
  for (const a of addrs) {
    assert.ok(a.kind === "lan" || a.kind === "tailscale");
    assert.match(a.host, /^\d+\.\d+\.\d+\.\d+$/);
    assert.ok(a.label.length > 0);
  }
});

test("ไม่มี IP วนกลับ (127.x) ปนมา — คนอื่นใช้ไม่ได้", () => {
  assert.ok(!joinAddresses().some((a) => a.host.startsWith("127.")));
});

test("LAN มาก่อน Tailscale เสมอ", () => {
  const kinds = joinAddresses().map((a) => a.kind);
  const lastLan = kinds.lastIndexOf("lan");
  const firstTs = kinds.indexOf("tailscale");
  if (lastLan !== -1 && firstTs !== -1) {
    assert.ok(lastLan < firstTs, "LAN ต้องอยู่ก่อน — เป็นทางที่คนส่วนใหญ่ใช้และเร็วกว่า");
  }
});
