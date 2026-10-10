/**
 * แปลง Discord user id เป็นชื่อที่อ่านออก
 *
 * client.users.fetch() ดู cache ของ discord.js ก่อนอยู่แล้ว แต่ id ที่ไม่เคยเจอ
 * จะยิง REST จริง ๆ ทีละคน — หน้าเว็บที่โชว์คน 20 คนพร้อมกันเลยกลายเป็น 20 คำขอ
 * ตัวช่วยนี้ยิงขนานกันแล้วรวมผล และ "จำ id ที่หาไม่เจอ" ไว้ด้วย ไม่งั้นคนที่ออก
 * เซิร์ฟเวอร์ไปแล้วจะถูกยิงถามซ้ำทุกครั้งที่รีเฟรชหน้า
 */
import type { Client } from "discord.js";

// จำ "หาไม่เจอ" แยก TTL ตามสาเหตุ:
//  - ถาวร (ออกจากเซิร์ฟเวอร์/id ไม่มีจริง) = 10 นาที
//  - timeout ชั่วคราว (rate limit/id ที่ fetch ค้าง) = 60 วิ พอให้โหลดเร็วแต่ยังลองใหม่เป็นระยะ
//    (ถ้าไม่จำเลย id ที่ค้างตลอดจะทำให้ทุกโหลดชน timeout 4 วิ)
const MISS_TTL = 10 * 60 * 1000;
const TIMEOUT_MISS_TTL = 60 * 1000;
const misses = new Map<string, { at: number; ttl: number }>();

// กันค้าง: users.fetch ไม่มี timeout ในตัว ถ้า Discord rate-limit หรือเน็ตสะดุด
// การ fetch คนเดียวค้างจะลาก Promise.all ค้างทั้งชุด → /api/members ไม่ตอบ → หน้าเว็บหมุนไม่จบ
const FETCH_TIMEOUT_MS = 4_000;

class FetchTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new FetchTimeout("fetch timeout")), ms).unref(),
    ),
  ]);
}

/** คืน map ของ id -> ชื่อ (id ที่หาไม่เจอจะไม่มีคีย์ ให้ผู้เรียก fallback เอง) */
export async function resolveNames(
  client: Client | undefined,
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!client) return out;

  const now = Date.now();
  const wanted: string[] = [];
  for (const id of new Set(ids)) {
    // 1) อ่านจาก cache ของ discord.js ก่อน (synchronous ไม่ยิงเน็ต)
    //    สำคัญ: fetch ที่เรา race-timeout ไป discord.js ยังทำต่อจนเสร็จแล้ว cache ไว้ให้
    //    รอบถัดมาเลยได้ชื่อจากตรงนี้ทันที ไม่ต้อง fetch ซ้ำ (และไม่ติดกับดัก miss)
    const cached = client.users.cache.get(id);
    if (cached) {
      out[id] = cached.username;
      continue;
    }
    // 2) ข้ามคนที่เพิ่งจำว่า "หาไม่เจอ" (ยังไม่หมดอายุ)
    const m = misses.get(id);
    if (m && now - m.at < m.ttl) continue;
    if (m) misses.delete(id);
    wanted.push(id);
  }

  // 3) เหลือเฉพาะคนที่ไม่มีใน cache จริง ๆ → fetch พร้อม timeout ต่อคน
  //    allSettled: คนที่ค้าง/พังถูกข้าม ไม่ลากทั้ง endpoint ค้าง (ผู้เรียก fallback เป็น id เอง)
  await Promise.allSettled(
    wanted.map(async (id) => {
      try {
        out[id] = (await withTimeout(client.users.fetch(id), FETCH_TIMEOUT_MS)).username;
      } catch (err) {
        // timeout จำสั้น (60 วิ) เคสถาวรจำยาว (10 นาที) — กันทั้งยิงซ้ำทุกรอบ และ id ที่ค้างตลอด
        const ttl = err instanceof FetchTimeout ? TIMEOUT_MISS_TTL : MISS_TTL;
        misses.set(id, { at: now, ttl });
      }
    }),
  );
  return out;
}
