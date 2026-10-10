/**
 * ต้นไม้หมวดหมู่ต้องชี้ไป event ที่ระบบสร้างได้จริง
 *
 * ถ้าพิมพ์ชื่อ event ผิดในต้นไม้ กิ่งนั้นจะกดแล้วว่างเปล่า ไม่มี error ไม่มีอะไรเตือน
 * ดูเผิน ๆ เหมือน "ยังไม่เคยเกิดเหตุการณ์นี้" ซึ่งแยกไม่ออกจากกรณีพิมพ์ผิดจริง ๆ
 * เทสนี้จับให้ตั้งแต่ตอน build
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOG_TREE, findLeaf } from "../src/web/ui/src/lib/logTree.js";
import { LOG_CATEGORIES } from "../src/store/logStore.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** อ่านไฟล์ .ts ทั้งหมดใน src/ (ยกเว้นหน้าเว็บ) มารวมเป็นข้อความก้อนเดียว */
function serverSource(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "ui") continue; // หน้าเว็บไม่ได้สร้าง event
        walk(full);
      } else if (name.endsWith(".ts")) {
        out.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(join(ROOT, "src"));
  return out.join("\n");
}

const SRC = serverSource();

/**
 * event ที่โค้ดสร้างได้ — รวมทั้งที่เขียนตรง ๆ และที่ต่อท้ายด้วย _on/_off
 * (VOICE_TOGGLES เก็บชื่อฐานไว้แล้วเติมท้ายตอนบันทึก)
 */
function canProduce(event: string): boolean {
  if (SRC.includes(`"${event}"`)) return true;
  const base = event.replace(/_(on|off)$/, "");
  return base !== event && SRC.includes(`"${base}"`);
}

test("ทุกกิ่งชี้ไป event ที่โค้ดสร้างได้จริง", () => {
  for (const node of LOG_TREE) {
    for (const leaf of node.leaves) {
      assert.ok(leaf.events.length > 0, `กิ่ง "${leaf.label}" ไม่ได้ระบุ event เลย`);
      for (const ev of leaf.events) {
        assert.ok(
          canProduce(ev),
          `กิ่ง "${leaf.label}" ชี้ไป event "${ev}" ที่ไม่มีในโค้ด — พิมพ์ผิดหรือเปล่า`,
        );
      }
    }
  }
});

test("id ของกิ่งไม่ซ้ำกันทั้งต้นไม้", () => {
  const seen = new Map<string, string>();
  for (const node of LOG_TREE) {
    for (const leaf of node.leaves) {
      const owner = seen.get(leaf.id);
      assert.ok(!owner, `id "${leaf.id}" ซ้ำระหว่าง "${owner}" กับ "${leaf.label}"`);
      seen.set(leaf.id, leaf.label);
    }
  }
});

test("event ไม่ถูกใช้ซ้ำข้ามกิ่ง", () => {
  // ถ้า event เดียวอยู่สองกิ่ง กด 2 กิ่งจะได้ผลซ้ำกันบางส่วน ซึ่งชวนสับสน
  const owner = new Map<string, string>();
  for (const node of LOG_TREE) {
    for (const leaf of node.leaves) {
      for (const ev of leaf.events) {
        const prev = owner.get(ev);
        assert.ok(!prev, `event "${ev}" อยู่ทั้งกิ่ง "${prev}" และ "${leaf.label}"`);
        owner.set(ev, leaf.label);
      }
    }
  }
});

test("ทุกหมวดของ server มีอยู่ในต้นไม้", () => {
  const inTree = LOG_TREE.map((n) => n.category).sort();
  assert.deepEqual(
    inTree,
    [...LOG_CATEGORIES].sort(),
    "เพิ่มหมวดใหม่แล้วต้องเพิ่มในต้นไม้ด้วย ไม่งั้นกดดูไม่ได้เลย",
  );
});

test("findLeaf หาเจอ และคืน null เมื่อไม่มี", () => {
  assert.equal(findLeaf("mic")?.events[0], "voice_mute_on");
  assert.equal(findLeaf("deaf")?.events[0], "voice_deafen_on");
  assert.deepEqual(findLeaf("join-leave")?.events, ["member_join", "member_leave"]);
  assert.equal(findLeaf("ไม่มีกิ่งนี้"), null);
  assert.equal(findLeaf(""), null);
  assert.equal(findLeaf(null), null);
});

test("ไมค์แดง/หูแดง ต้องเป็นขาปิดเท่านั้น", () => {
  // เคสที่ตั้งใจแก้รอบนี้ — ถ้าเผลอใส่ _off เข้าไปด้วย กิ่งจะกลับไปปนสองขาเหมือนเดิม
  for (const id of ["mic", "deaf"]) {
    const leaf = findLeaf(id);
    assert.ok(leaf);
    assert.ok(
      leaf.events.every((e) => e.endsWith("_on")),
      `กิ่ง "${leaf.label}" ต้องมีแต่ขาปิด (_on) ไม่งั้นจะได้ขาเปิดปนมาด้วย`,
    );
  }
});
