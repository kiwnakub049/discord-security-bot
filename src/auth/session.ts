import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../store/db.js";

/**
 * Session ของ dashboard — เก็บในตาราง sessions ของ data/bot.db
 *
 * cookie เก็บแค่ "<token>.<hmac>" — token สุ่ม 256-bit เซ็นด้วย SESSION_SECRET กันปลอม
 * ส่วนใน DB เก็บ "sha256(token)" ไม่ใช่ตัว token
 * เหตุผล: ไฟล์ DB ถูกสำรองเป็น .gz ทุกคืน (ดู src/scripts/backupDb.ts) และย้ายออก
 * นอกเครื่องได้ ถ้าเก็บ token ดิบไว้ ใครได้ไฟล์สำรองไปก็สวมสิทธิ์เข้า dashboard ได้ทันที
 * การเก็บเป็น hash ทำให้ไฟล์สำรองเอาไปใช้ต่อไม่ได้
 *
 * อายุ 30 วัน "นับจากครั้งล่าสุดที่ใช้" — เข้าดูเรื่อย ๆ ก็ไม่มีวันหมดอายุ
 * แต่ทิ้งเครื่องไว้เกินเดือนแล้วมันจะหลุดเอง
 *
 * หมายเหตุ: การตัดสิทธิ์ user ที่ถูกลบไม่ได้อยู่ที่นี่ — middleware เช็ค userExists()
 * ทุก request อีกชั้น ลบ user เมื่อไหร่ session เดิมใช้ไม่ได้ทันที
 */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน

/**
 * เขียน last_seen ถี่แค่ไหน
 *
 * ถ้าอัปเดตทุก request จะเป็นการเขียน DB หนึ่งครั้งต่อการโหลดหน้าหนึ่งครั้ง
 * ซึ่งเปลืองเปล่า ๆ บน SD card — หน้าเว็บ poll ทุก 10 วินาทีอยู่แล้ว
 * เขียนแค่เมื่อผ่านไปเกิน 5 นาทีก็พอ ความแม่นระดับนาทีไม่มีผลกับการต่ออายุ 30 วัน
 */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export interface SessionMeta {
  userAgent: string;
  ip: string;
}

export interface SessionRow {
  id: string;
  username: string;
  created_at: number;
  last_seen: number;
  expires: number;
  user_agent: string;
  ip: string;
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("ไม่ได้ตั้ง SESSION_SECRET ใน .env");
  return s;
}

function sign(token: string): string {
  return createHmac("sha256", getSecret()).update(token).digest("hex");
}

/** id ที่เก็บใน DB = sha256 ของ token (ไม่เก็บ token ตรง ๆ) */
function idOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * แกะ cookie เป็น token ถ้าลายเซ็นถูกต้อง
 * เช็คแบบ timing-safe เพื่อไม่ให้เดาลายเซ็นทีละตัวอักษรจากเวลาที่ใช้ตอบ
 */
function tokenFrom(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 0) return null;

  const token = cookie.slice(0, dot);
  const mac = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(sign(token));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  return token;
}

const insert = db.prepare(
  `INSERT INTO sessions (id, username, created_at, last_seen, expires, user_agent, ip)
   VALUES (@id, @username, @now, @now, @expires, @ua, @ip)`,
);
const selectById = db.prepare("SELECT * FROM sessions WHERE id = ?");
const touch = db.prepare(
  "UPDATE sessions SET last_seen = @now, expires = @expires, ip = @ip WHERE id = @id",
);
const deleteById = db.prepare("DELETE FROM sessions WHERE id = ?");

/** สร้าง session ใหม่ คืนค่าที่จะใส่ใน cookie */
export function createSession(username: string, meta?: SessionMeta): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  insert.run({
    id: idOf(token),
    username,
    now,
    expires: now + SESSION_TTL_MS,
    ua: (meta?.userAgent ?? "").slice(0, 300),
    ip: (meta?.ip ?? "").slice(0, 60),
  });
  return `${token}.${sign(token)}`;
}

export interface Resolved {
  username: string;
  /** id ในตาราง (sha256) — ใช้ทำเครื่องหมาย "เครื่องนี้" ในหน้าจัดการอุปกรณ์ */
  id: string;
  /** true เมื่อเพิ่งต่ออายุ — ผู้เรียกควรตั้ง cookie ใหม่ให้ maxAge ตรงกับของจริง */
  refreshed: boolean;
}

/**
 * ตรวจ cookie แล้วคืนข้อมูล session ถ้ายังใช้ได้ ไม่งั้น null
 * พร้อมต่ออายุให้อัตโนมัติ (แต่ไม่ถี่กว่า TOUCH_EVERY_MS)
 */
export function resolveSession(
  cookie: string | undefined,
  meta?: SessionMeta,
): Resolved | null {
  const token = tokenFrom(cookie);
  if (!token) return null;

  const id = idOf(token);
  const row = selectById.get(id) as SessionRow | undefined;
  if (!row) return null;

  const now = Date.now();
  if (row.expires < now) {
    deleteById.run(id);
    return null;
  }

  const refreshed = now - row.last_seen >= TOUCH_EVERY_MS;
  if (refreshed) {
    touch.run({
      id,
      now,
      expires: now + SESSION_TTL_MS,
      ip: (meta?.ip ?? row.ip).slice(0, 60),
    });
  }
  return { username: row.username, id, refreshed };
}

/**
 * session id นี้ยังมีอยู่และยังไม่หมดอายุไหม — ใช้โดย connection ที่เปิดค้างยาว (SSE)
 * ที่ resolveSession ตอนเปิดครั้งเดียวแล้วไม่ได้เช็คซ้ำอีก ถ้า session ถูก revoke
 * (เปลี่ยนรหัส/เตะอุปกรณ์) ระหว่างที่ stream ยังเปิดอยู่ ต้องปิด stream ตาม
 */
export function sessionExists(id: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sessions WHERE id = ? AND expires > ?")
    .get(id, Date.now());
  return row !== undefined;
}

/** ลบ session ของ cookie นี้ (ตอน logout) */
export function destroySession(cookie: string | undefined): void {
  const token = tokenFrom(cookie);
  if (token) deleteById.run(idOf(token));
}

/** อุปกรณ์ทั้งหมดที่บัญชีนี้ยัง login ค้างอยู่ — ใหม่สุดก่อน */
export function listSessions(username: string): SessionRow[] {
  return db
    .prepare(
      "SELECT * FROM sessions WHERE username = ? AND expires > ? ORDER BY last_seen DESC",
    )
    .all(username, Date.now()) as SessionRow[];
}

/**
 * เตะเครื่องหนึ่งออก — คืน true ถ้าลบจริง
 * บังคับให้ตรงกับ username ด้วย กันคนหนึ่งไปเตะ session ของอีกคนโดยเดา id
 */
export function revokeSession(username: string, id: string): boolean {
  return (
    db.prepare("DELETE FROM sessions WHERE id = ? AND username = ?").run(id, username)
      .changes > 0
  );
}

/** เตะทุกเครื่องของบัญชีนี้ ยกเว้นเครื่องที่กำลังใช้อยู่ — คืนจำนวนที่เตะ */
export function revokeOtherSessions(username: string, keepId: string): number {
  return db
    .prepare("DELETE FROM sessions WHERE username = ? AND id <> ?")
    .run(username, keepId).changes;
}

/**
 * เตะทุกเครื่องของบัญชีนี้ — คืนจำนวนที่เตะ
 *
 * ใช้ตอนเปลี่ยนรหัสผ่านและตอนลบบัญชี
 * จำเป็นเพราะ session อยู่ได้ 30 วันแล้ว ถ้าเปลี่ยนรหัสแล้วของเก่ายังใช้ได้
 * การเปลี่ยนรหัสจะไม่ช่วยอะไรเลยในกรณีที่สงสัยว่าเครื่องหลุดมือไป
 */
export function revokeAllSessions(username: string): number {
  return db.prepare("DELETE FROM sessions WHERE username = ?").run(username).changes;
}

/** ลบ session ที่หมดอายุแล้ว — คืนจำนวนที่ลบ */
export function pruneSessions(): number {
  return db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now()).changes;
}

// เก็บกวาดตอนบูตหนึ่งครั้ง แล้วซ้ำทุก 6 ชม.
pruneSessions();
setInterval(pruneSessions, 6 * 60 * 60 * 1000).unref();
