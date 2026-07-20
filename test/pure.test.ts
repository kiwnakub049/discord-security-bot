/**
 * ทดสอบ #3 esc() และ #6 csvCell() — ดึงซอร์สจริงจาก index.html มา eval (ไม่เขียนซ้ำ)
 * กันไม่ให้ escaping / formula-injection guard หลุดหายตอนแก้ dashboard ครั้งหน้า
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(
  join(__dirname, "..", "src", "web", "public", "index.html"),
  "utf8",
);

function extract(name: string, re: RegExp): string {
  const m = html.match(re);
  if (!m) throw new Error(`หา ${name} ในไฟล์ไม่เจอ`);
  return m[0];
}
const esc = new Function(
  `${extract("esc", /function esc\(s\) \{[\s\S]*?\n {6}\}/)}\nreturn esc;`,
)() as (s: unknown) => string;
const csvCell = new Function(
  `${extract("csvCell", /function csvCell\(v\) \{[\s\S]*?\n {6}\}/)}\nreturn csvCell;`,
)() as (v: unknown) => string;

test("#3 esc(): escape & < > \" '", () => {
  assert.equal(esc("a'b"), "a&#39;b");
  assert.equal(esc("<b>"), "&lt;b&gt;");
  assert.equal(esc('"x"'), "&quot;x&quot;");
  assert.equal(esc("a&b"), "a&amp;b");
});

test("#3 esc(): XSS payload ไม่มี single quote ดิบเหลือ", () => {
  const payload = "x'),alert(document.cookie),removeModUser('x";
  assert.ok(!esc(payload).includes("'"));
});

test("#6 csvCell(): เติม ' นำหน้าเซลล์ที่ขึ้นต้นด้วย = + - @", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.ok(csvCell("+cmd").startsWith("'"));
  assert.ok(csvCell("-2+3").startsWith("'"));
  assert.ok(csvCell("@SUM").startsWith("'"));
  assert.ok(csvCell("=HYPERLINK(x)").startsWith("'"));
});

test("#6 csvCell(): ค่าปกติ/comma ทำงานถูก", () => {
  assert.equal(csvCell("hello"), "hello");
  assert.equal(csvCell("a,b"), '"a,b"');
});
