/**
 * แยก event ของ log เก่าให้ตรงกับของใหม่
 *
 * ก่อนหน้านี้ event เดียวเก็บทั้งขาเปิดและขาปิดปนกัน (voice_mute มีทั้ง "ปิดไมค์"
 * และ "เปิดไมค์") ทำให้กิ่ง "ไมค์แดง" บนหน้าเว็บกรองไม่ได้ — กดแล้วได้ทั้งสองขา
 * เหมือนกันกับ audit_channel ที่รวมสร้าง/ลบ/แก้สิทธิ์ไว้ด้วยกัน
 *
 * ตัวชี้ขาดว่าแถวเก่าเป็นขาไหน มีอย่างเดียวคือ title ที่บันทึกไว้ตอนนั้น
 * ตารางข้างล่างจึงจับคู่จาก title ตรง ๆ — ถ้าเจอ title ที่ไม่รู้จักจะรายงานไว้
 * ไม่เดาสุ่ม เพราะเดาผิดแปลว่า log ถูกจัดหมวดผิดถาวรโดยไม่มีใครรู้
 *
 * รันซ้ำได้ — แถวที่แยกแล้วจะไม่เข้าเงื่อนไขอีก
 *
 *   npm run db:split-events -- --dry   ดูก่อน ไม่เขียนจริง
 *   npm run db:split-events            แก้จริง
 */
import { db } from "../store/db.js";

const DRY = process.argv.includes("--dry");

/** event เดิม → (title → event ใหม่) */
const RULES: Record<string, Record<string, string>> = {
  voice_mute: {
    "ปิดไมค์ตัวเอง (ไมค์แดง)": "voice_mute_on",
    เปิดไมค์ตัวเอง: "voice_mute_off",
  },
  voice_deafen: {
    "ปิดหูฟังตัวเอง (หูแดง)": "voice_deafen_on",
    เปิดหูฟังตัวเอง: "voice_deafen_off",
  },
  voice_server: {
    "ถูกแอดมินปิดไมค์ (server mute)": "voice_server_on",
    "ถูกแอดมินปิดหูฟัง (server deafen)": "voice_server_on",
    แอดมินเปิดไมค์ให้: "voice_server_off",
    แอดมินเปิดหูฟังให้: "voice_server_off",
  },
  voice_stream: {
    "เริ่ม Go Live (แชร์หน้าจอ)": "voice_stream_on",
    "หยุด Go Live": "voice_stream_off",
  },
  voice_camera: {
    เปิดกล้อง: "voice_camera_on",
    ปิดกล้อง: "voice_camera_off",
  },
  audit_channel: {
    สร้างห้อง: "audit_channel_create",
    ลบห้อง: "audit_channel_delete",
    ตั้งสิทธิ์ในห้อง: "audit_channel_perm",
    แก้สิทธิ์ในห้อง: "audit_channel_perm",
    ลบสิทธิ์ในห้อง: "audit_channel_perm",
  },
};

type Row = { id: number; event: string; title: string };

const rows = db
  .prepare(
    `SELECT id, event, title FROM logs
      WHERE event IN (${Object.keys(RULES).map(() => "?").join(",")})`,
  )
  .all(...Object.keys(RULES)) as Row[];

const plan: { id: number; from: string; to: string }[] = [];
const unknown = new Map<string, number>();

for (const row of rows) {
  const to = RULES[row.event]?.[row.title];
  if (!to) {
    const key = `${row.event} / ${row.title}`;
    unknown.set(key, (unknown.get(key) ?? 0) + 1);
    continue;
  }
  plan.push({ id: row.id, from: row.event, to });
}

if (unknown.size > 0) {
  console.warn("⚠️  เจอ title ที่ไม่มีในตารางจับคู่ — ข้ามไว้ ไม่เดา:");
  for (const [k, n] of unknown) console.warn(`   ${k}  (${n} แถว)`);
  console.warn("   ถ้าอยากให้ย้ายด้วย ให้เพิ่มบรรทัดใน RULES แล้วรันใหม่\n");
}

if (plan.length === 0) {
  console.log("✅ ไม่มีอะไรต้องแยก — event ตรงกับของใหม่หมดแล้ว");
  process.exit(0);
}

const summary = new Map<string, number>();
for (const p of plan) {
  const k = `${p.from} → ${p.to}`;
  summary.set(k, (summary.get(k) ?? 0) + 1);
}
console.log(`จะแยก ${plan.length} แถว:`);
for (const [k, n] of [...summary].sort()) console.log(`  ${k.padEnd(46)} ${n}`);

if (DRY) {
  console.log("\n(--dry: ไม่ได้เขียนอะไรลง DB)");
  process.exit(0);
}

const update = db.prepare("UPDATE logs SET event = ? WHERE id = ?");
// ธุรกรรมเดียว — ถ้าพลาดกลางทางจะไม่เหลือสภาพแยกไปครึ่งเดียว
db.transaction(() => {
  for (const p of plan) update.run(p.to, p.id);
})();

console.log(`\n✅ แยกแล้ว ${plan.length} แถว`);
