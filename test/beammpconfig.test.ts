/**
 * ทดสอบตัวอ่าน/แก้ ServerConfig.toml
 *
 * ไฟล์นี้มี AuthKey ของเซิร์ฟเวอร์อยู่ด้วย และหน้าเว็บเป็นคนสั่งแก้
 * ถ้าตัวนี้พลาด = คีย์ลับหลุดออกเว็บ หรือถูกเขียนทับจนเซิร์ฟรันไม่ขึ้น
 * เทสจึงเน้นสองเรื่อง: คีย์ลับต้องไม่รั่ว และค่าจากผู้ใช้ต้องแทรกคีย์ใหม่ไม่ได้
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPatch,
  hasAuthKey,
  parseConfig,
  patchConfig,
  publicValues,
} from "../src/beammp/serverConfig.js";
import { validateField } from "../src/beammp/fields.js";

/** ไฟล์จริงที่ BeamMP v3.9.3 สร้างมา (ตัดมาบางส่วน คงคอมเมนต์ไว้) */
const SAMPLE = `# This is the BeamMP-Server config file.
[Misc]
UpdateReminderTime = "30s"
ImScaredOfUpdates = true

[General]
Description = "BeamMP Default Description"
MaxCars = 1
# Whether to log chat messages in the console / log
LogChat = true
ResourceFolder = "Resources"
IP = "::"
Name = "BeamMP Server"
Private = true
AllowGuests = true
Port = 30814
Debug = false
Tags = "Freeroam"
AuthKey = "secret-key-do-not-leak"
MaxPlayers = 8
Map = "/levels/gridmap_v2/info.json"
`;

function tmpConfig(text = SAMPLE): string {
  const p = join(mkdtempSync(join(tmpdir(), "beammp-")), "ServerConfig.toml");
  writeFileSync(p, text);
  return p;
}

test("อ่านค่าได้ครบทุกชนิด (ข้อความ/ตัวเลข/บูลีน)", () => {
  const { values } = parseConfig(SAMPLE);
  const g = values.get("General")!;
  assert.equal(g.get("Name"), "BeamMP Server");
  assert.equal(g.get("MaxPlayers"), 8);
  assert.equal(g.get("Private"), true);
  assert.equal(g.get("Debug"), false);
  assert.equal(values.get("Misc")!.get("UpdateReminderTime"), "30s");
});

test("AuthKey ไม่โผล่ในค่าที่ส่งไปเว็บ", () => {
  const pub = publicValues(SAMPLE);
  assert.ok(!("AuthKey" in pub), "AuthKey ต้องไม่อยู่ในผลลัพธ์");
  assert.ok(
    !JSON.stringify(pub).includes("secret-key-do-not-leak"),
    "ค่าคีย์ต้องไม่ปนมาในช่องไหนเลย",
  );
  assert.equal(pub.Name, "BeamMP Server"); // แต่ค่าปกติต้องมา
});

test("บอกได้ว่าตั้ง AuthKey แล้วหรือยัง โดยไม่เปิดเผยคีย์", () => {
  assert.equal(hasAuthKey(SAMPLE), true);
  assert.equal(hasAuthKey(SAMPLE.replace(/AuthKey = ".*"/, 'AuthKey = ""')), false);
});

test("แก้ค่าแล้วคอมเมนต์และคีย์อื่นยังอยู่ครบ", () => {
  const p = tmpConfig();
  const r = applyPatch(p, { Name: "UNDAWN Drift", MaxPlayers: 16 });
  assert.deepEqual(r, { ok: true, applied: ["Name", "MaxPlayers"] });

  const out = readFileSync(p, "utf8");
  assert.match(out, /Name = "UNDAWN Drift"/);
  assert.match(out, /MaxPlayers = 16/);
  assert.match(out, /# Whether to log chat messages/, "คอมเมนต์ต้องไม่หาย");
  assert.match(out, /AuthKey = "secret-key-do-not-leak"/, "AuthKey ต้องไม่ถูกแตะ");
  assert.match(out, /Port = 30814/, "คีย์ที่ไม่ได้แก้ต้องคงเดิม");
});

test("แก้ AuthKey จากหน้าเว็บไม่ได้", () => {
  const p = tmpConfig();
  const r = applyPatch(p, { AuthKey: "ของปลอม" });
  assert.equal(r.ok, false);
  assert.match(readFileSync(p, "utf8"), /AuthKey = "secret-key-do-not-leak"/);
});

test("ค่าที่มี \" ต้อง escape ไม่ใช่ทำไฟล์พัง", () => {
  const p = tmpConfig();
  assert.deepEqual(applyPatch(p, { Name: 'เซิร์ฟ "ของเรา"' }), {
    ok: true,
    applied: ["Name"],
  });
  // อ่านกลับต้องได้ค่าเดิมเป๊ะ = escape แล้ว decode ได้ครบวง
  assert.equal(publicValues(readFileSync(p, "utf8")).Name, 'เซิร์ฟ "ของเรา"');
});

test("แทรกคีย์ใหม่ผ่านค่าที่ขึ้นบรรทัดใหม่ไม่ได้", () => {
  const attack = 'ชื่อ"\nAuthKey = "ยึดแล้ว';
  const v = validateField("Name", attack);
  assert.equal(v.ok, false, "ต้องโดนปัดตกตั้งแต่ตอนตรวจ");

  const p = tmpConfig();
  assert.equal(applyPatch(p, { Name: attack }).ok, false);
  assert.match(readFileSync(p, "utf8"), /AuthKey = "secret-key-do-not-leak"/);
});

test("ค่านอกช่วงที่ยอมรับถูกปัดตก และไม่เขียนอะไรเลยสักค่า", () => {
  const p = tmpConfig();
  // Name ถูกต้อง แต่ MaxPlayers เกิน -> ต้องไม่เขียน Name ด้วย
  const r = applyPatch(p, { Name: "ใหม่", MaxPlayers: 999 });
  assert.equal(r.ok, false);
  assert.match(readFileSync(p, "utf8"), /Name = "BeamMP Server"/, "ต้องไม่เขียนบางส่วน");
});

test("แผนที่ต้องเป็นรูปแบบ path ของเกม", () => {
  assert.equal(validateField("Map", "/levels/italy/info.json").ok, true);
  assert.equal(validateField("Map", "อะไรก็ได้").ok, false);
  assert.equal(validateField("Map", "/etc/passwd").ok, false);
  assert.equal(validateField("Map", "/levels/../../etc/info.json").ok, false);
});

test("แผนที่จากม็อด: ชื่อมีจุด/ขีดได้ แต่ต้องออกนอกโฟลเดอร์ไม่ได้", () => {
  // ม็อดจริงตั้งชื่อโฟลเดอร์แบบนี้กันเยอะ
  assert.equal(validateField("Map", "/levels/drift.playground.v2/info.json").ok, true);
  assert.equal(validateField("Map", "/levels/my-map_01/info.json").ok, true);

  // แต่ห้ามเป็นทางออกนอกโฟลเดอร์เกม
  assert.equal(validateField("Map", "/levels/../info.json").ok, false);
  assert.equal(validateField("Map", "/levels/a..b/info.json").ok, false);
  assert.equal(validateField("Map", "/levels/./info.json").ok, false);
  assert.equal(validateField("Map", "/levels/.hidden/info.json").ok, false);
  // ชื่อที่มีสแลชซ้อน = ลงลึกไปอีกชั้น ไม่ใช่รูปแบบที่ยอมรับ
  assert.equal(validateField("Map", "/levels/a/b/info.json").ok, false);
});

test("คีย์ชื่อซ้ำกันคนละ section ต้องไม่แก้ผิดอัน", () => {
  const text = `[Misc]\nName = "อย่าแตะ"\n\n[General]\nName = "แก้อันนี้"\n`;
  const { text: out } = patchConfig(
    text,
    new Map([["Name", { section: "General", value: "ใหม่" }]]),
  );
  assert.match(out, /\[Misc\]\nName = "อย่าแตะ"/);
  assert.match(out, /Name = "ใหม่"/);
});

test("คีย์ที่ไม่มีในไฟล์ -> รายงานแทนที่จะแทรกใหม่เงียบ ๆ", () => {
  const p = tmpConfig(`[General]\nName = "x"\n`);
  const r = applyPatch(p, { MaxPlayers: 8 });
  assert.equal(r.ok, false);
  assert.equal(readFileSync(p, "utf8"), `[General]\nName = "x"\n`);
});
