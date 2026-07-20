import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "../store/db.js";

/**
 * บัญชี mod สำหรับเข้า dashboard
 * รหัสผ่านเก็บเป็น scrypt hash (built-in ของ Node — ไม่ต้องลง lib เพิ่ม)
 * เก็บในตาราง users ของ data/bot.db (อยู่ใน .gitignore แล้ว — ไม่หลุดขึ้น git)
 */

const KEYLEN = 64;

// scrypt แบบ async — ไม่บล็อก event loop ตอนคำนวณ hash (ป้องกัน DoS ทั้งบอทตอนมีคนยิง login รัว ๆ)
const scryptAsync = promisify(scrypt);

interface UserRecord {
  username: string;
  salt: string; // hex
  hash: string; // hex
}

async function deriveHash(password: string, salt: string): Promise<Buffer> {
  return (await scryptAsync(password, salt, KEYLEN)) as Buffer;
}

/** มี user นี้อยู่ในรายชื่อที่อนุญาตหรือไม่ — middleware เรียกทุก request */
export function userExists(username: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM users WHERE username = ?")
    .get(username);
  return row !== undefined;
}

export function listUsers(): string[] {
  return db
    .prepare("SELECT username FROM users ORDER BY username")
    .all()
    .map((r) => (r as { username: string }).username);
}

export async function addUser(username: string, password: string): Promise<void> {
  if (userExists(username)) {
    throw new Error(`มี user "${username}" อยู่แล้ว`);
  }
  const salt = randomBytes(16).toString("hex");
  const hash = (await deriveHash(password, salt)).toString("hex");
  db.prepare(
    "INSERT INTO users (username, salt, hash) VALUES (?, ?, ?)",
  ).run(username, salt, hash);
}

/** คืน true ถ้าลบจริง, false ถ้าไม่เจอ user นี้ */
export function removeUser(username: string): boolean {
  const info = db.prepare("DELETE FROM users WHERE username = ?").run(username);
  return info.changes > 0;
}

export async function verifyPassword(
  username: string,
  password: string,
): Promise<boolean> {
  const user = db
    .prepare("SELECT username, salt, hash FROM users WHERE username = ?")
    .get(username) as UserRecord | undefined;
  if (!user) {
    // เผา CPU เท่า ๆ กันแม้ไม่มี user เพื่อไม่ให้ดูจาก timing ออกว่า username มีจริงไหม
    await deriveHash(password, "dummy-salt");
    return false;
  }
  const computed = await deriveHash(password, user.salt);
  const stored = Buffer.from(user.hash, "hex");
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}
