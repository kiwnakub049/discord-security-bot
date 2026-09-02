/**
 * หมวดของ log ต้องมีครบทั้งชื่อและไอคอน ทั้งฝั่ง server และฝั่งหน้าเว็บ
 *
 * เคสที่กันไว้: เพิ่มหมวดใหม่ใน src/store/logStore.ts แล้วลืมไปเติมชื่อ/ไอคอนในหน้าเว็บ
 * ผลคือหน้าเว็บจะขึ้นไอคอนสำรอง (list) กับชื่อดิบเป็นภาษาอังกฤษ ซึ่งดูไม่ออกว่าผิด
 * จนกว่าจะมีคนสังเกต — เทสนี้ทำให้รู้ตั้งแต่ตอน build
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_CATEGORIES } from "../src/store/logStore.js";
import {
  CATEGORIES,
  CATEGORY_ICON,
  CATEGORY_LABEL,
  iconOf,
  labelOf,
} from "../src/web/ui/src/lib/categories.js";

test("รายชื่อหมวดของหน้าเว็บตรงกับของ server", () => {
  assert.deepEqual(
    [...CATEGORIES].sort(),
    [...LOG_CATEGORIES].sort(),
    "เพิ่ม/ลบหมวดแล้วต้องแก้ทั้งสองที่",
  );
});

test("ทุกหมวดมีชื่อภาษาไทย", () => {
  for (const c of LOG_CATEGORIES) {
    const label = CATEGORY_LABEL[c];
    assert.ok(label, `หมวด "${c}" ยังไม่มีชื่อ`);
    assert.notEqual(label, c, `หมวด "${c}" ยังใช้ชื่อดิบอยู่`);
  }
});

test("ทุกหมวดมีไอคอนของตัวเอง ไม่ซ้ำกัน", () => {
  const used = new Map<string, string>();
  for (const c of LOG_CATEGORIES) {
    const icon = CATEGORY_ICON[c];
    assert.ok(icon, `หมวด "${c}" ยังไม่มีไอคอน`);
    const owner = used.get(icon);
    assert.ok(
      !owner,
      `หมวด "${c}" ใช้ไอคอน "${icon}" ซ้ำกับ "${owner}" — แยกไม่ออกว่าอันไหนเป็นอันไหน`,
    );
    used.set(icon, c);
  }
});

test("ไอคอนที่ชี้ไว้มีอยู่จริงใน Icon.tsx", async () => {
  // อ่านไฟล์เป็นข้อความแทนการ import — Icon.tsx เป็น component ที่ต้องใช้ React
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src/web/ui/src/components/Icon.tsx",
    ),
    "utf8",
  );
  for (const c of LOG_CATEGORIES) {
    const icon = CATEGORY_ICON[c];
    assert.match(
      src,
      new RegExp(`(^|\\s)"?${icon}"?\\s*:`, "m"),
      `ไอคอน "${icon}" (หมวด ${c}) ไม่มีใน PATHS ของ Icon.tsx`,
    );
  }
});

test("หมวดที่ไม่รู้จักมีค่าสำรอง ไม่ทำให้หน้าพัง", () => {
  assert.equal(labelOf("อะไรก็ไม่รู้"), "อะไรก็ไม่รู้");
  assert.equal(iconOf("อะไรก็ไม่รู้"), "list");
});
