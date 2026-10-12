/**
 * หน้าเว็บสองภาษา
 * - ทุก t("…") ในหน้าเว็บมีคำแปลอังกฤษ
 * - ไม่มีข้อความไทยหลุดนอก t() (นอกคอมเมนต์) — บรรทัดที่ตั้งใจให้เป็นไทยใส่ // i18n-ignore
 * - คำแปลต้องคงตัวแปร {x} ครบ
 * - server แปล message/error ตาม X-Lang / cookie
 *
 * รัน `I18N_REPORT=1 npm test` เพื่อดูรายการที่ยังขาดทั้งหมด
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const UI = "src/web/ui/src";
const THAI = /[฀-๿]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return p.endsWith("i18n") ? [] : files(p);
    return /\.(tsx?|ts)$/.test(f) && !p.endsWith("lib/i18n.ts") ? [p] : [];
  });
}

/** ลบคอมเมนต์ แต่คงจำนวนบรรทัด (ให้รายงานเลขบรรทัดถูก) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[\s;,{}()])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
}

const T_CALL = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;

function scan() {
  const keys = new Map<string, string>();
  const leaks: string[] = [];
  for (const f of files(UI)) {
    const src = stripComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(T_CALL)) keys.set(JSON.parse(`"${m[1]}"`), f);
    src.split("\n").forEach((line, i) => {
      if (/i18n-ignore/.test(readFileSync(f, "utf8").split("\n")[i] ?? "")) return;
      if (THAI.test(line.replace(T_CALL, ""))) leaks.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return { keys, leaks };
}

test("ทุก t() มีคำแปล · คำแปลคงตัวแปรครบ", async () => {
  const { EN } = await import("../src/web/ui/src/i18n/index.js");
  const { keys } = scan();
  const missing = [...keys].filter(([k]) => !(k in EN)).map(([k, f]) => `${f}: ${k}`);
  if (process.env.I18N_REPORT) console.error(missing.join("\n"));
  assert.deepEqual(missing, [], `ขาดคำแปล ${missing.length} รายการ`);
  const bad = Object.entries(EN).filter(([th, en]) => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    return vars(th) !== vars(en);
  });
  assert.deepEqual(bad, []);
});

test("ไม่มีข้อความไทยหลุดนอก t()", () => {
  const { leaks } = scan();
  if (process.env.I18N_REPORT) console.error(leaks.join("\n"));
  assert.deepEqual(leaks, [], `ไทยหลุด ${leaks.length} บรรทัด`);
});

test("server: แปล message ตาม X-Lang / cookie · ไม่เลือก = ไทย", async () => {
  const { tr, langOf } = await import("../src/web/i18n.js");
  const req = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] }) as never;
  assert.equal(langOf(req({ "x-lang": "en" })), "en");
  assert.equal(langOf(req({ cookie: "a=1; lang=en" })), "en");
  assert.equal(langOf(req({ "accept-language": "th-TH,th;q=0.9" })), "th");
  assert.equal(langOf(req({})), "th");
  assert.equal(tr("ข้อความที่ไม่มีในพจนานุกรม", "th"), "ข้อความที่ไม่มีในพจนานุกรม");
});
