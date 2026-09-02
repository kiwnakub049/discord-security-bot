/**
 * ย้าย log เก่าของบอทพาร์ทเนอร์เข้าหมวด "partner" ย้อนหลัง
 *
 * ก่อนมีทะเบียนใน src/partners.ts การกระทำของบอทพวกนี้ถูกบันทึกเป็นหมวด "audit"
 * ปนกับงานของ mod คนจริง และช่อง "ผู้ทำ" เป็นเลข id เปล่า ๆ เพราะ Discord
 * resolve ชื่อบอทไม่ได้ สคริปต์นี้ตามไปแก้ทั้งสองอย่างให้ตรงกับของใหม่
 *
 * รันซ้ำได้ — แถวที่ย้ายแล้วจะไม่เข้าเงื่อนไขอีก
 *
 *   npm run db:tag-partners -- --dry   ดูว่าจะแก้อะไรบ้าง ไม่เขียนจริง
 *   npm run db:tag-partners            แก้จริง
 */
import { db } from "../store/db.js";
import {
  PARTNER_BOTS,
  partnerFromActor,
  partnerLabel,
  type PartnerBot,
} from "../partners.js";

const DRY = process.argv.includes("--dry");

type Row = { id: number; category: string; fields: string; title: string };
type Field = { name: string; value: string };

/** แถวที่ "ผู้ทำ" ตรงกับบอทพาร์ทเนอร์ตัวใดตัวหนึ่ง */
function findRows(): { row: Row; bot: PartnerBot; fields: Field[] }[] {
  // กรองหยาบ ๆ ด้วย LIKE ก่อนเพื่อไม่ต้องแกะ JSON ทุกแถวในตาราง
  // แล้วค่อยยืนยันให้แน่ด้วยการอ่านช่อง "ผู้ทำ" จริง ๆ
  const like = PARTNER_BOTS.map(() => "fields LIKE ?").join(" OR ");
  const rows = db
    .prepare(`SELECT id, category, fields, title FROM logs WHERE ${like}`)
    .all(...PARTNER_BOTS.map((p) => `%${p.id}%`)) as Row[];

  const out: { row: Row; bot: PartnerBot; fields: Field[] }[] = [];
  for (const row of rows) {
    let fields: Field[];
    try {
      fields = JSON.parse(row.fields) as Field[];
    } catch {
      continue; // fields พัง — ข้ามไป ดีกว่าทำ log เสียหายเพิ่ม
    }
    const actor = fields.find((f) => f.name === "ผู้ทำ");
    if (!actor) continue;
    const bot = partnerFromActor(actor.value);
    // เฉพาะแถวที่ยังไม่ตรงกับของใหม่ — ทั้งหมวดและชื่อ
    if (!bot) continue;
    const needsCategory = row.category !== "partner";
    const needsName = actor.value !== partnerLabel(bot);
    if (!needsCategory && !needsName) continue;
    out.push({ row, bot, fields });
  }
  return out;
}

const targets = findRows();

if (targets.length === 0) {
  console.log("✅ ไม่มีอะไรต้องย้าย — log ของบอทพาร์ทเนอร์ตรงกับของใหม่หมดแล้ว");
  process.exit(0);
}

const byBot = new Map<string, number>();
for (const t of targets) byBot.set(t.bot.name, (byBot.get(t.bot.name) ?? 0) + 1);

console.log(`พบ ${targets.length} รายการที่ต้องย้าย`);
for (const [name, n] of byBot) console.log(`  ${name}: ${n} รายการ`);

if (DRY) {
  console.log("\nตัวอย่าง 5 รายการแรก:");
  for (const t of targets.slice(0, 5)) {
    const actor = t.fields.find((f) => f.name === "ผู้ทำ")?.value;
    console.log(
      `  #${t.row.id} ${t.row.title} — หมวด ${t.row.category} → partner, ผู้ทำ "${actor}" → "${partnerLabel(t.bot)}"`,
    );
  }
  console.log("\n(--dry: ไม่ได้เขียนอะไรลง DB)");
  process.exit(0);
}

const update = db.prepare(
  "UPDATE logs SET category = 'partner', fields = ? WHERE id = ?",
);

// ทำเป็นธุรกรรมเดียว — ถ้าพลาดกลางทางจะไม่เหลือสภาพย้ายไปครึ่งหนึ่ง
const apply = db.transaction(() => {
  for (const { row, bot, fields } of targets) {
    const next = fields.map((f) =>
      f.name === "ผู้ทำ" ? { ...f, value: partnerLabel(bot) } : f,
    );
    // เพิ่มช่องบอกบทบาท ให้เหมือนกับที่ของใหม่บันทึก
    if (!next.some((f) => f.name === "บอทพาร์ทเนอร์")) {
      const at = next.findIndex((f) => f.name === "รายละเอียด");
      next.splice(at >= 0 ? at + 1 : next.length, 0, {
        name: "บอทพาร์ทเนอร์",
        value: bot.role,
      });
    }
    update.run(JSON.stringify(next), row.id);
  }
});
apply();

console.log(`\n✅ ย้ายแล้ว ${targets.length} รายการเข้าหมวด partner`);
