import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session แบบเก็บฝั่ง server (in-memory):
 *  - cookie เก็บแค่ "<sessionId>.<hmac>" — ตัว id สุ่ม 256-bit, เซ็นด้วย SESSION_SECRET กันปลอม
 *  - logout = ลบ session ฝั่ง server จริง (cookie ที่ค้างใช้ไม่ได้ทันที)
 *  - restart บอท = session หาย ต้อง login ใหม่ (ยอมรับได้ และปลอดภัยกว่า)
 *
 * หมายเหตุ: การ "ตัดสิทธิ์ user ที่ถูกลบ" ไม่ได้อยู่ที่นี่ แต่ middleware จะเช็ค userExists()
 * ทุก request อีกชั้น — ดังนั้นลบ user ออกเมื่อไหร่ session เดิมก็ใช้ไม่ได้ทันที
 */

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 วัน

interface Session {
  username: string;
  expires: number;
}

const sessions = new Map<string, Session>();

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("ไม่ได้ตั้ง SESSION_SECRET ใน .env");
  return s;
}

function sign(id: string): string {
  return createHmac("sha256", getSecret()).update(id).digest("hex");
}

/** สร้าง session ใหม่ คืนค่า cookie ที่จะ set */
export function createSession(username: string): string {
  const id = randomBytes(32).toString("hex");
  sessions.set(id, { username, expires: Date.now() + SESSION_TTL_MS });
  return `${id}.${sign(id)}`;
}

/** ตรวจ cookie แล้วคืน username ถ้า valid, ไม่งั้น null */
export function resolveSession(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 0) return null;

  const id = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);

  // เช็คลายเซ็นแบบ timing-safe
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(sign(id));
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
    return null;
  }

  const session = sessions.get(id);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session.username;
}

/** ลบ session (ตอน logout) */
export function destroySession(cookie: string | undefined): void {
  if (!cookie) return;
  const dot = cookie.lastIndexOf(".");
  if (dot < 0) return;
  sessions.delete(cookie.slice(0, dot));
}

// เคลียร์ session ที่หมดอายุทุก 1 ชม. กัน memory โต
setInterval(
  () => {
    const now = Date.now();
    for (const [id, s] of sessions) if (s.expires < now) sessions.delete(id);
  },
  60 * 60 * 1000,
).unref();
