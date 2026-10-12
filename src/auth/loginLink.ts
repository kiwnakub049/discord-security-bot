import { createHash, randomBytes } from "node:crypto";
import { db } from "../store/db.js";

/**
 * login ผ่านแอป Discord
 *
 * 1) ลิงก์ครั้งเดียวจาก /dashboard — บอทตอบ ephemeral ให้เห็นคนเดียว กดแล้วเข้าเว็บได้เลย
 *    ไม่ต้อง login Discord ในเบราว์เซอร์ (ตัวตนมาจากคำสั่งที่พิมพ์ในแอปอยู่แล้ว)
 * 2) state ของ OAuth เก็บใน DB ด้วย — กดปุ่มบนเว็บแล้วแอป Discord อาจพากลับมาใน
 *    browser ในแอป ซึ่งไม่มี cookie state ของเรา
 *
 * เก็บแค่ sha256 ของ token/state ทั้งคู่ — ใครเปิด DB ได้ก็เอาไปใช้ไม่ได้
 */

export const LINK_TTL_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN_RE = /^[a-f0-9]{64}$/;

export function createLoginLink(userId: string, now = Date.now()): string {
  db.prepare("DELETE FROM login_links WHERE expires_at < ?").run(now);
  const token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO login_links (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(hash(token), userId, now, now + LINK_TTL_MS);
  return token;
}

/** ลิงก์ยังใช้ได้ไหม — ดูเฉย ๆ ไม่ใช้ token (หน้ายืนยันก่อนกด) */
export function peekLoginLink(token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const row = db
    .prepare("SELECT user_id FROM login_links WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?")
    .get(hash(token), now) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

/** ใช้ลิงก์ — ได้ userId ครั้งแรกครั้งเดียว ครั้งต่อไปได้ null */
export function consumeLoginLink(token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const info = db
    .prepare(
      "UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ? RETURNING user_id",
    )
    .get(now, hash(token), now) as { user_id: string } | undefined;
  return info?.user_id ?? null;
}

export function rememberState(state: string, now = Date.now()): void {
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now);
  db.prepare("INSERT OR REPLACE INTO oauth_states (state_hash, expires_at) VALUES (?, ?)").run(
    hash(state),
    now + STATE_TTL_MS,
  );
}

/** state นี้เราออกให้จริงและยังไม่หมดอายุไหม — ใช้ได้ครั้งเดียว (ลบทิ้งทันที) */
export function takeState(state: string, now = Date.now()): boolean {
  if (!state) return false;
  return (
    db.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND expires_at >= ?").run(hash(state), now)
      .changes > 0
  );
}
