import { createWriteStream, existsSync, statSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { paths } from "./paths.js";
import { MAX_MOD_BYTES, safeModName, tooBigMessage } from "./mods.js";

/**
 * อัปโหลดไฟล์ใหญ่แบบซอยเป็นก้อน
 *
 * ── ทำไมต้องซอย ทั้งที่ฝั่งเราสตรีมได้อยู่แล้ว ──
 * เว็บวิ่งผ่าน Cloudflare Tunnel ซึ่งแผนฟรีจำกัด body ที่ 100 MiB ต่อคำขอ
 * (วัดแล้ว: 104,857,600 bytes ขึ้นไปโดน 413 จากขอบของ Cloudflare
 *  ตั้งแต่ยังไม่ถึงเครื่องเรา — ไฟล์เล็กที่ path เดียวกันได้ 401 จากแอปเรา)
 * เป็นเพดานที่แก้ที่โค้ดเราไม่ได้เลย ทางเดียวคือส่งทีละก้อนให้แต่ละคำขอเล็กพอ
 *
 * ── ทำไมบังคับส่งเรียงลำดับ ──
 * ต่อไฟล์ด้วยการเขียนต่อท้าย ถ้ายอมให้ก้อนมาสลับลำดับ ต้องจัดการรูโหว่กลางไฟล์เอง
 * ซึ่งพลาดแล้วจะได้ zip ที่ดูขนาดถูกแต่ข้างในพัง — ตรวจเจอยากมาก
 */

/** ก้อนละ 48MB — ต่ำกว่าเพดาน Cloudflare เยอะพอที่ header/overhead ไม่ทำให้เกิน */
export const CHUNK_BYTES = 48 * 1024 * 1024;

/** เซสชันที่ค้างเกินเวลานี้ถือว่าคนอัปหายไปแล้ว — ลบทิ้งกันไฟล์ขยะกินดิสก์ */
const SESSION_TTL_MS = 60 * 60 * 1000;

interface Session {
  name: string;
  partPath: string;
  received: number;
  at: number;
}

const sessions = new Map<string, Session>();

export function beginUpload(
  rawName: string,
): { ok: true; id: string; chunkBytes: number } | { ok: false; error: string } {
  sweep();
  const name = safeModName(rawName);
  if (!name) return { ok: false, error: "ชื่อไฟล์ใช้ไม่ได้ — ต้องเป็นไฟล์ .zip" };

  const id = randomBytes(16).toString("hex");
  /*
   * ตั้งชื่อไฟล์ชั่วคราวจาก id ไม่ใช่จากชื่อไฟล์ผู้ใช้ — ถ้าสองคนอัปชื่อเดียวกัน
   * พร้อมกัน (หรือคนเดิมกดซ้ำ) จะเขียนทับกันจนได้ไฟล์ปนกัน
   */
  const partPath = join(paths.mods, `.upload-${id}.part`);
  sessions.set(id, { name, partPath, received: 0, at: Date.now() });
  return { ok: true, id, chunkBytes: CHUNK_BYTES };
}

export async function writeChunk(
  id: string,
  offset: number,
  body: Readable,
  declared?: number,
): Promise<{ ok: true; received: number } | { ok: false; error: string }> {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: "ไม่พบรายการอัปโหลดนี้ (อาจหมดเวลาไปแล้ว)" };
  if (offset !== s.received)
    return {
      ok: false,
      error: `ก้อนข้อมูลมาไม่ตรงลำดับ (คาดว่า ${s.received} ได้ ${offset})`,
    };
  if (declared !== undefined && s.received + declared > MAX_MOD_BYTES) {
    abortUpload(id);
    return { ok: false, error: tooBigMessage() };
  }

  let written = 0;
  let tooBig = false;
  try {
    // flags "a" = เขียนต่อท้าย ไม่ใช่ทับ — แต่ละก้อนจึงต่อกันเป็นไฟล์เดียว
    const out = createWriteStream(s.partPath, { flags: "a" });
    body.on("data", (c: Buffer) => {
      written += c.length;
      if (s.received + written > MAX_MOD_BYTES && !tooBig) {
        tooBig = true;
        body.destroy(new Error("เกินขนาด"));
      }
    });
    await pipeline(body, out);
  } catch {
    abortUpload(id);
    return { ok: false, error: tooBig ? tooBigMessage() : "ส่งก้อนข้อมูลไม่สำเร็จ" };
  }

  s.received += written;
  s.at = Date.now();
  return { ok: true, received: s.received };
}

/** ปิดงาน: ตรวจว่าเป็น zip จริงแล้วย้ายไปเป็นชื่อจริง */
export function finishUpload(
  id: string,
): { ok: true; name: string; partPath: string } | { ok: false; error: string } {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: "ไม่พบรายการอัปโหลดนี้" };
  sessions.delete(id);

  if (!existsSync(s.partPath) || statSync(s.partPath).size === 0) {
    return { ok: false, error: "ไฟล์ว่าง" };
  }
  return { ok: true, name: s.name, partPath: s.partPath };
}

export function abortUpload(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  safeUnlink(s.partPath);
}

export function safeUnlink(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // ลบไม่ได้ก็ปล่อย — ตัวกวาดจะมาเก็บรอบหน้า
  }
}

/** ลบเซสชันที่ค้างนานเกินไป */
function sweep(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.at > SESSION_TTL_MS) {
      sessions.delete(id);
      safeUnlink(s.partPath);
    }
  }
}

/** จำนวนงานที่ค้างอยู่ — ใช้ในเทส */
export function pendingCount(): number {
  return sessions.size;
}
