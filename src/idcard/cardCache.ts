import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIdCard } from "./cardGenerator.js";
import { getActivity } from "../store/activityStore.js";
import type { MemberCard } from "./members.js";

/**
 * Cache รูปบัตร: เซฟไว้ที่ data/cards/<id>.png
 * เก็บ "ลายเซ็น" ของข้อมูล (ชื่อ/avatar/status/วันที่/เวอร์ชัน layout) คู่กัน
 * ถ้าลายเซ็นตรง = ใช้ไฟล์เดิม (เร็ว), ถ้าเปลี่ยน = gen ใหม่ทับ (ไม่เก่า)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(__dirname, "..", "..", "data", "cards");

// bump ค่านี้เมื่อแก้ layout บัตร เพื่อให้ regenerate ใหม่ทั้งหมด
const CARD_VERSION = "2026-07-level";

function signature(
  username: string,
  avatarUrl: string,
  card: MemberCard,
  level: number,
): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        v: CARD_VERSION,
        username,
        avatarUrl,
        n: card.member_number,
        j: card.join_date,
        s: card.status,
        lv: level, // ใช้ level ไม่ใช่ xp — บัตร regen เฉพาะตอนเลื่อนเลเวล
      }),
    )
    .digest("hex");
}

/** คืนรูปบัตร — จาก cache ถ้ายังตรง, ไม่งั้น gen ใหม่แล้วเซฟ */
export async function getCardImage(
  userId: string,
  username: string,
  avatarUrl: string,
  card: MemberCard,
): Promise<Buffer> {
  mkdirSync(cacheDir, { recursive: true });
  const pngFile = join(cacheDir, `${userId}.png`);
  const sigFile = join(cacheDir, `${userId}.sig`);
  const level = getActivity(userId).level;
  const sig = signature(username, avatarUrl, card, level);

  if (
    existsSync(pngFile) &&
    existsSync(sigFile) &&
    readFileSync(sigFile, "utf8") === sig
  ) {
    return readFileSync(pngFile);
  }

  const buf = await generateIdCard(username, userId, avatarUrl, card, level);
  writeFileSync(pngFile, buf);
  writeFileSync(sigFile, sig);
  return buf;
}

/** ลบ cache ของคนนี้ (บังคับ gen ใหม่ครั้งหน้า) */
export function invalidateCard(userId: string): void {
  rmSync(join(cacheDir, `${userId}.png`), { force: true });
  rmSync(join(cacheDir, `${userId}.sig`), { force: true });
}
