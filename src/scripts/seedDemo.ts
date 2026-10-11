/**
 * สร้างฐานข้อมูลตัวอย่างด้วยข้อมูลสมมติ — ไว้ถ่ายภาพประกอบ
 *
 * ทำไมต้องมี: ฟอร์มขอ privileged intent ของ Discord บังคับให้แนบภาพหน้าจอ
 * ที่แสดงว่าฟีเจอร์ทำงานยังไง แต่ภาพจาก dashboard จริงมีชื่อสมาชิกจริง
 * ข้อความจริง และเหตุผลแบนจริง ซึ่งเอาขึ้นที่สาธารณะไม่ได้
 *
 * ชื่อ ข้อความ และ ID ในไฟล์นี้แต่งขึ้นทั้งหมด ไม่มีของใครจริง
 *
 *   BOT_DB_PATH=/tmp/demo.db npm run db:seed-demo
 *   BOT_DB_PATH=/tmp/demo.db WEB_PORT=3100 npm run web
 */
import { db } from "../store/db.js";
import { enqueue } from "../store/queueStore.js";
import { addMessage } from "../store/ticketStore.js";

if (!process.env.BOT_DB_PATH) {
  console.error(
    "❌ ต้องตั้ง BOT_DB_PATH ก่อน — สคริปต์นี้เขียนทับข้อมูลทั้งฐาน\n" +
      "   ถ้ารันทับ data/bot.db จริงจะลบของจริงทิ้งหมด",
  );
  process.exit(1);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = Date.now();

/** ชื่อสมมติ — ตั้งให้ดูเหมือนชื่อจริงในคอมมูนิตี้ไทย แต่ไม่ใช่ของใคร */
const PEOPLE = [
  { id: "100000000000000001", name: "somchai.dev" },
  { id: "100000000000000002", name: "nong_ploy" },
  { id: "100000000000000003", name: "kittipong99" },
  { id: "100000000000000004", name: "mint.chan" },
  { id: "100000000000000005", name: "arthit_x" },
  { id: "100000000000000006", name: "bbyfahsai" },
];
const MODS = ["moderator01", "moderator02"];
const CHANNELS = ["ห้องนั่งเล่น", "คุยเล่น", "เกม", "Village Square"];

const pick = <T>(a: T[], i: number): T => a[i % a.length]!;

const insertLog = db.prepare(
  `INSERT INTO logs (timestamp, level, category, event, title, description, fields)
   VALUES (?, ?, ?, ?, ?, NULL, ?)`,
);
type Field = { name: string; value: string };
const log = (
  minutesAgo: number,
  level: string,
  category: string,
  event: string,
  title: string,
  fields: Field[],
): void => {
  insertLog.run(now - minutesAgo * MIN, level, category, event, title, JSON.stringify(fields));
};
const who = (i: number): string => {
  const p = pick(PEOPLE, i);
  return `${p.name} (${p.id})`;
};

// ---- ล้างของเดิมในฐานตัวอย่าง ----
for (const t of ["logs", "members", "activity", "warnings", "ai_verdicts", "sessions", "queue_items", "ticket_messages"]) {
  db.prepare(`DELETE FROM ${t}`).run();
}

// ---- AI จับข้อความ toxic — ฟีเจอร์หลักที่ต้องใช้ Message Content ----
const TOXIC = [
  { text: "ไอ้โง่ เล่นห่วยแตกมาก ออกไปเลย", score: 0.94, auto: true },
  { text: "อย่ามายุ่งกับกู ไป๊", score: 0.71, auto: false },
  { text: "พวกมึงนี่กากจริง ๆ", score: 0.88, auto: true },
  { text: "เล่นไม่เป็นก็อย่าเล่น", score: 0.52, auto: false },
];
TOXIC.forEach((t, i) => {
  log(
    12 + i * 37,
    t.auto ? "alert" : "warn",
    "security",
    "security_ai",
    t.auto
      ? "AI ตรวจพบข้อความ toxic — จัดการอัตโนมัติ"
      : "AI สงสัยว่าเป็นข้อความ toxic — รอ mod ตรวจ",
    [
      { name: "User", value: who(i) },
      { name: "ห้อง", value: pick(CHANNELS, i) },
      { name: "ข้อความ", value: t.text },
      { name: "คะแนน", value: t.score.toFixed(2) },
      { name: "การจัดการ", value: t.auto ? "ลบข้อความ + เตือน" : "รอ mod ตัดสิน" },
    ],
  );
});

// คำตัดสินของ mod = ข้อมูลเทรนรอบหน้า (แถวที่เก็บถาวร ตามที่แจ้งในนโยบาย)
const verdict = db.prepare(
  `INSERT INTO ai_verdicts (log_id, verdict, score, zone, text, user_id, decided_by, decided_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const aiRows = db.prepare("SELECT id FROM logs WHERE event = 'security_ai' ORDER BY id").all() as {
  id: number;
}[];
aiRows.forEach((row, i) => {
  const t = TOXIC[i]!;
  verdict.run(
    row.id,
    i === 3 ? "ok" : "toxic",
    t.score,
    t.auto ? "auto" : "review",
    t.text,
    pick(PEOPLE, i).id,
    pick(MODS, i),
    now - (10 + i * 30) * MIN,
  );
});

// ---- anti-spam / auto-mod — อีกสองอย่างที่ต้องใช้ Message Content ----
log(48, "warn", "security", "security_spam", "ตรวจพบสแปม — ส่งข้อความรัว", [
  { name: "User", value: who(4) },
  { name: "ห้อง", value: pick(CHANNELS, 1) },
  { name: "รายละเอียด", value: "9 ข้อความใน 5 วินาที (เกิน 5)" },
  { name: "การจัดการ", value: "timeout 10 นาที" },
]);
log(95, "warn", "security", "security_spam", "ตรวจพบสแปม — ข้อความซ้ำ", [
  { name: "User", value: who(2) },
  { name: "ห้อง", value: pick(CHANNELS, 0) },
  { name: "รายละเอียด", value: "ข้อความเดิมซ้ำ 5 ครั้งติดกัน (เกิน 3)" },
  { name: "การจัดการ", value: "ลบข้อความ + เตือน" },
]);
log(160, "alert", "security", "security_automod", "ลบลิงก์เชิญเข้าเซิร์ฟเวอร์อื่น", [
  { name: "User", value: who(5) },
  { name: "ห้อง", value: pick(CHANNELS, 2) },
  { name: "รายละเอียด", value: "พบลิงก์เชิญในข้อความ" },
  { name: "การจัดการ", value: "ลบข้อความ" },
]);

// ---- anti-raid + เข้า-ออกเซิร์ฟเวอร์ — ต้องใช้ Server Members ----
log(210, "alert", "security", "security_raid", "🚨 ตรวจพบการบุกเซิร์ฟเวอร์ (raid)", [
  { name: "รายละเอียด", value: "มีคนเข้า 14 คนภายใน 10 วินาที (เกินเกณฑ์ 8)" },
  { name: "การจัดการ", value: "เตะบัญชีที่เข้าในช่วงนั้นออก 14 บัญชี" },
]);
[0, 1, 2].forEach((i) => {
  log(211 + i, "warn", "security", "security_newaccount", "บัญชีใหม่น่าสงสัยเข้าเซิร์ฟเวอร์", [
    { name: "User", value: who(i) },
    { name: "อายุบัญชี", value: `${i + 1} วัน (น้อยกว่าเกณฑ์ 7 วัน)` },
  ]);
});
[6, 33, 71, 120].forEach((m, i) => {
  log(m, "info", "member", "member_join", "สมาชิกเข้าเซิร์ฟเวอร์", [
    { name: "User", value: who(i) },
    { name: "อายุบัญชี", value: `${120 + i * 40} วัน` },
  ]);
});
[18, 52, 140].forEach((m, i) => {
  log(m, "info", "member", "member_leave", "สมาชิกออกจากเซิร์ฟเวอร์", [
    { name: "User", value: who(i + 2) },
  ]);
});

// ---- ห้องเสียง (ไม่ต้องใช้ privileged intent) ----
[
  ["voice_join", "เข้าห้องเสียง", 4],
  ["voice_mute_on", "ปิดไมค์ตัวเอง (ไมค์แดง)", 9],
  ["voice_deafen_on", "ปิดหูฟังตัวเอง (หูแดง)", 15],
  ["voice_move", "ย้ายห้องเสียง", 26],
  ["voice_leave", "ออกจากห้องเสียง", 40],
].forEach(([event, title, m], i) => {
  log(m as number, "info", "voice", event as string, title as string, [
    { name: "User", value: who(i) },
    { name: "ห้อง", value: pick(CHANNELS, 3) },
  ]);
});

// ---- ปฏิบัติการของ mod (audit) ----
log(30, "alert", "audit", "audit_ban", "แบนสมาชิก (ban)", [
  { name: "ผู้ทำ", value: `${MODS[0]} (100000000000000099)` },
  { name: "เป้าหมาย", value: who(5) },
  { name: "รายละเอียด", value: "-" },
  { name: "เหตุผล", value: "โพสต์ลิงก์หลอกลวงซ้ำหลายครั้ง" },
]);
log(88, "warn", "audit", "audit_timeout", "ตั้ง timeout (หมดเวลาพูดชั่วคราว)", [
  { name: "ผู้ทำ", value: `${MODS[1]} (100000000000000098)` },
  { name: "เป้าหมาย", value: who(1) },
  { name: "รายละเอียด", value: "communication_disabled_until" },
]);
log(175, "warn", "audit", "audit_role", "เปลี่ยน role สมาชิก", [
  { name: "ผู้ทำ", value: `${MODS[0]} (100000000000000099)` },
  { name: "เป้าหมาย", value: who(3) },
  { name: "รายละเอียด", value: "+role: สมาชิกยืนยันแล้ว" },
]);

// ---- ระบบ ----
log(2, "info", "system", "system_online", "บอทออนไลน์", [
  { name: "Bot", value: "UNDAWN#0000" },
  { name: "เซิร์ฟเวอร์", value: "1" },
]);
log(5, "info", "system", "system_login", "เข้าสู่ระบบ dashboard", [
  { name: "User", value: MODS[0]! },
  { name: "IP", value: "100.64.0.2" },
]);

// ---- สมาชิก / กิจกรรม ----
const member = db.prepare(
  "INSERT INTO members (user_id, member_number, join_date, bias, status) VALUES (?, ?, ?, ?, ?)",
);
const activity = db.prepare(
  "INSERT INTO activity (user_id, messages, voice_seconds, xp, last_message_at) VALUES (?, ?, ?, ?, ?)",
);
PEOPLE.forEach((p, i) => {
  member.run(p.id, i + 1, `0${i + 1}/0${(i % 9) + 1}/2568`, "-", "-");
  activity.run(p.id, 120 - i * 15, 7200 - i * 900, 900 - i * 120, now - (i + 1) * HOUR);
});

const warn = db.prepare(
  "INSERT INTO warnings (user_id, reason, moderator_id, moderator_tag, timestamp) VALUES (?, ?, ?, ?, ?)",
);
warn.run(PEOPLE[1]!.id, "ส่งข้อความรัวในห้องนั่งเล่น", "100000000000000099", MODS[0]!, now - 3 * HOUR);
warn.run(PEOPLE[4]!.id, "ใช้คำหยาบใส่สมาชิกคนอื่น", "100000000000000098", MODS[1]!, now - 26 * HOUR);

// ---- คิวรอดำเนินการ (หน้าแรก) — ชื่อ/ID สมมติทั้งหมด ----
const ago = (m: number): number => now - m * MIN;
enqueue({ category: "ban-approval", subjectId: "100000000000000201", title: "spam_bot_7731", detail: "ส่งลิงก์เชิญซ้ำ 14 ห้องใน 40 วินาที", at: ago(52) });
enqueue({ category: "ban-approval", subjectId: "100000000000000202", title: "free.nitro.th", detail: "ส่งลิงก์ฟิชชิ่ง Nitro ใน DM สมาชิก 6 คน", at: ago(18) });
enqueue({ category: "ban-approval", subjectId: PEOPLE[4]!.id, title: PEOPLE[4]!.name, detail: "เตือนครบ 3 ครั้งภายใน 7 วัน", at: ago(6) });
enqueue({ category: "suspicious-member", subjectId: "100000000000000301", title: "user84422190", detail: "บัญชีอายุ 2 วัน · เข้าพร้อมกัน 9 บัญชี", at: ago(35) });
enqueue({ category: "suspicious-member", subjectId: "100000000000000302", title: "user84422191", detail: "บัญชีอายุ 2 วัน · ไม่มีรูปโปรไฟล์", at: ago(34) });
{
  // ticket ตำรวจ พร้อมบทสนทนาที่ตำรวจตอบกลับมาล่าสุด (การ์ดต้องขึ้น "ตำรวจตอบมา")
  const p = PEOPLE[1]!;
  const detail = "ครั้งนั้นเพื่อนใช้เครื่องพิมพ์แทน";
  const t = enqueue({ category: "admin-ticket", subjectId: p.id, title: "ขอปลดเตือนครั้งที่ 2", detail, at: ago(26 * 60) });
  const say = (kind: "police" | "admin", body: string, m: number, delivered?: boolean) =>
    addMessage({ queueId: t, authorKind: kind, authorId: kind === "police" ? p.id : "flick", authorName: kind === "police" ? p.name : "flick", body, delivered, at: ago(m) });
  say("police", detail, 26 * 60);
  say("admin", "มีหลักฐานไหมว่าตอนนั้นไม่ได้พิมพ์เอง เช่น แชทกับเพื่อนคนนั้น", 25 * 60, true);
  say("police", "มีครับ แคปแชทไว้ตามนี้\nเพื่อนยอมรับเองว่ายืมเครื่องไปตอนผมไปเข้าห้องน้ำ", 40);
}

const counts = db.prepare("SELECT count(*) c FROM logs").get() as { c: number };
console.log(`✅ สร้างข้อมูลตัวอย่างแล้ว: log ${counts.c} รายการ, สมาชิก ${PEOPLE.length} คน`);
console.log(`   ฐานข้อมูล: ${process.env.BOT_DB_PATH}`);
