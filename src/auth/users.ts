import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "../store/db.js";
import { revokeAllSessions } from "./session.js";

/**
 * บัญชี mod สำหรับเข้า dashboard
 * รหัสผ่านเก็บเป็น scrypt hash (built-in ของ Node — ไม่ต้องลง lib เพิ่ม)
 * เก็บในตาราง users ของ data/bot.db (อยู่ใน .gitignore แล้ว — ไม่หลุดขึ้น git)
 */

const KEYLEN = 64;

// scrypt แบบ async — ไม่บล็อก event loop ตอนคำนวณ hash (ป้องกัน DoS ทั้งบอทตอนมีคนยิง login รัว ๆ)
const scryptAsync = promisify(scrypt);

/** ระดับสิทธิ์บัญชี dashboard: admin จัดการบัญชี+ตั้งค่าได้, mod ได้แค่ดู+moderate */
export type Role = "admin" | "mod";

export function isRole(v: unknown): v is Role {
  return v === "admin" || v === "mod";
}

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

/** รายชื่อบัญชีพร้อม role — ใช้โดยหน้าจัดการบัญชี */
export function listUsersWithRoles(): { username: string; role: Role }[] {
  return db
    .prepare("SELECT username, role FROM users ORDER BY username")
    .all() as { username: string; role: Role }[];
}

/** role ของบัญชีนี้ — null ถ้าไม่มีบัญชี (ใช้ตัดสินสิทธิ์ใน middleware) */
export function getRole(username: string): Role | null {
  const row = db
    .prepare("SELECT role FROM users WHERE username = ?")
    .get(username) as { role: string } | undefined;
  return row && isRole(row.role) ? row.role : null;
}

/** จำนวน admin ทั้งระบบ — กันลบ/ลดขั้น admin คนสุดท้ายจนไม่มีใครจัดการบัญชีได้ */
export function countAdmins(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as {
      n: number;
    }
  ).n;
}

export async function addUser(
  username: string,
  password: string,
  role: Role = "mod", // บัญชีที่สร้างใหม่เริ่มที่สิทธิ์ต่ำสุดเสมอ (least privilege)
): Promise<void> {
  if (userExists(username)) {
    throw new Error(`มี user "${username}" อยู่แล้ว`);
  }
  const salt = randomBytes(16).toString("hex");
  const hash = (await deriveHash(password, salt)).toString("hex");
  db.prepare(
    "INSERT INTO users (username, salt, hash, role) VALUES (?, ?, ?, ?)",
  ).run(username, salt, hash, role);
}

/**
 * เปลี่ยน role ของบัญชี — คืน false ถ้าไม่เจอบัญชี หรือจะทำให้ admin หมดระบบ
 * (ลด admin คนสุดท้ายเป็น mod = ไม่มีใครจัดการบัญชีได้อีก)
 */
export function setRole(username: string, role: Role): boolean {
  const current = getRole(username);
  if (!current) return false;
  if (current === "admin" && role !== "admin" && countAdmins() <= 1) {
    return false;
  }
  db.prepare("UPDATE users SET role = ? WHERE username = ?").run(role, username);
  return true;
}

/**
 * ตั้งรหัสผ่านใหม่ให้ user ที่มีอยู่ — คืน false ถ้าไม่เจอ user นี้
 *
 * สุ่ม salt ใหม่ทุกครั้ง ไม่ใช้ของเดิมซ้ำ เพื่อให้ hash เก่าที่อาจหลุดไปแล้ว
 * ใช้เทียบกับอันใหม่ไม่ได้เลย
 */
export async function setPassword(
  username: string,
  password: string,
): Promise<boolean> {
  if (!userExists(username)) return false;
  const salt = randomBytes(16).toString("hex");
  const hash = (await deriveHash(password, salt)).toString("hex");
  db.prepare("UPDATE users SET salt = ?, hash = ? WHERE username = ?").run(
    salt,
    hash,
    username,
  );
  // เตะทุกเครื่องที่ยัง login ค้างอยู่ — session อยู่ได้ 30 วัน ถ้าไม่เตะ
  // การเปลี่ยนรหัสจะไม่ช่วยอะไรเลยตอนที่สงสัยว่าเครื่องหลุดมือไป
  revokeAllSessions(username);
  return true;
}

/**
 * คืน true ถ้าลบจริง, false ถ้าไม่เจอ user นี้ หรือเป็น admin คนสุดท้าย
 * (ลบ admin คนสุดท้าย = ไม่มีใครจัดการบัญชี/ตั้งค่าได้อีก ต้องกันไว้)
 */
export function removeUser(username: string): boolean {
  if (getRole(username) === "admin" && countAdmins() <= 1) return false;
  const info = db.prepare("DELETE FROM users WHERE username = ?").run(username);
  // middleware เช็ค userExists ทุก request อยู่แล้ว session เลยใช้ไม่ได้ทันที
  // แต่ยังต้องลบแถวทิ้ง ไม่งั้นค้างอยู่ในตารางจนหมดอายุเอง 30 วันให้เปลือง
  if (info.changes > 0) revokeAllSessions(username);
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
