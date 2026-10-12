import { db } from "./db.js";

/**
 * การสมัครรับแจ้งเตือนมือถือ/เบราว์เซอร์ (Web Push) — แยกต่อเครื่อง
 * endpoint คือที่อยู่ของเครื่องนั้นบน push service (Google/Apple/Mozilla) ใช้เป็น id
 */

export const PUSH_TOPICS = ["queue", "mention", "general"] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

export interface PushSub {
  endpoint: string;
  userId: string;
  keys: { p256dh: string; auth: string };
  topics: PushTopic[];
  lang: "th" | "en";
}

interface Row {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  topics: string;
  lang: string;
}

export const cleanTopics = (raw: unknown): PushTopic[] =>
  Array.isArray(raw) ? PUSH_TOPICS.filter((t) => raw.includes(t)) : [];

function toSub(r: Row): PushSub {
  let topics: PushTopic[] = [];
  try {
    topics = cleanTopics(JSON.parse(r.topics));
  } catch {
    /* แถวเสีย = ไม่รับอะไร */
  }
  return {
    endpoint: r.endpoint,
    userId: r.user_id,
    keys: { p256dh: r.p256dh, auth: r.auth },
    topics,
    lang: r.lang === "en" ? "en" : "th",
  };
}

/**
 * บันทึก/อัปเดตเครื่องนี้ — endpoint เดิมแต่คนใหม่ (เปลี่ยนบัญชีบนเครื่องเดียวกัน) = ย้ายเป็นของคนใหม่
 */
export function saveSub(sub: PushSub): void {
  db.prepare(
    `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, topics, lang, created_at)
     VALUES (@endpoint, @user_id, @p256dh, @auth, @topics, @lang, @now)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       topics = excluded.topics, lang = excluded.lang`,
  ).run({
    endpoint: sub.endpoint,
    user_id: sub.userId,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    topics: JSON.stringify(sub.topics),
    lang: sub.lang,
    now: Date.now(),
  });
}

export function getSub(endpoint: string, userId: string): PushSub | undefined {
  const r = db.prepare("SELECT * FROM push_subs WHERE endpoint = ? AND user_id = ?").get(endpoint, userId) as
    | Row
    | undefined;
  return r ? toSub(r) : undefined;
}

/** ลบเครื่อง — เฉพาะของคนนั้นเอง (กันคนอื่นยิง endpoint มาลบ) */
export function deleteSub(endpoint: string, userId?: string): boolean {
  return userId
    ? db.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").run(endpoint, userId).changes > 0
    : db.prepare("DELETE FROM push_subs WHERE endpoint = ?").run(endpoint).changes > 0;
}

/** ทุกเครื่องที่รับเรื่องนี้ (ไม่ระบุ userIds = ทุกคน) */
export function subsFor(topic: PushTopic, userIds?: string[]): PushSub[] {
  const rows = db.prepare("SELECT * FROM push_subs").all() as Row[];
  const want = userIds ? new Set(userIds) : null;
  return rows.map(toSub).filter((s) => s.topics.includes(topic) && (!want || want.has(s.userId)));
}

export function markOk(endpoint: string): void {
  db.prepare("UPDATE push_subs SET last_ok_at = ? WHERE endpoint = ?").run(Date.now(), endpoint);
}

/** กุญแจ VAPID (ตัวตนของ server ต่อ push service) — สร้างครั้งแรกแล้วเก็บไว้ ห้ามเปลี่ยน ไม่งั้นทุกเครื่องต้องสมัครใหม่ */
export function loadVapid(generate: () => { publicKey: string; privateKey: string }): {
  publicKey: string;
  privateKey: string;
} {
  const row = db.prepare("SELECT v FROM bot_kv WHERE k = 'push.vapid'").get() as { v: string } | undefined;
  if (row) return JSON.parse(row.v) as { publicKey: string; privateKey: string };
  const keys = generate();
  db.prepare("INSERT OR IGNORE INTO bot_kv (k, v) VALUES ('push.vapid', ?)").run(JSON.stringify(keys));
  // สองโปรเซสสร้างพร้อมกัน — อ่านของที่ชนะกลับมา
  return JSON.parse(
    (db.prepare("SELECT v FROM bot_kv WHERE k = 'push.vapid'").get() as { v: string }).v,
  ) as { publicKey: string; privateKey: string };
}
