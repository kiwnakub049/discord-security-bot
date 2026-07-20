import { config } from "../config.js";
import { db } from "./db.js";

/**
 * ระบบ activity / XP — สะสมแต้มจากข้อความ + เวลาในห้องเสียง
 * เก็บในตาราง activity ของ data/bot.db
 *
 * สูตรเลเวล (level เริ่มที่ 1):
 *   XP สะสมที่ต้องมีเพื่อ "ถึง" level L  =  50 * (L-1) * L
 *   L1=0, L2=100, L3=300, L4=600, L5=1000, ...  (แต่ละเลเวลถัดไปต้องใช้ XP เพิ่มขึ้นเรื่อย ๆ)
 */

export interface Activity {
  userId: string;
  messages: number;
  voiceSeconds: number;
  xp: number;
  level: number;
}

/** ผลของการให้ XP ครั้งหนึ่ง — ใช้ตรวจว่า "เลื่อนเลเวล" ไหม เพื่อประกาศ */
export interface XpResult {
  userId: string;
  awardedXp: number; // XP ที่ได้ครั้งนี้ (0 = ไม่ได้ เช่นติด cooldown)
  xp: number; // XP รวมหลังบวก
  oldLevel: number;
  newLevel: number;
  leveledUp: boolean;
}

function xpResult(userId: string, oldXp: number, gained: number): XpResult {
  const xp = oldXp + gained;
  const oldLevel = levelFromXp(oldXp);
  const newLevel = levelFromXp(xp);
  return { userId, awardedXp: gained, xp, oldLevel, newLevel, leveledUp: newLevel > oldLevel };
}

/** XP สะสมที่ต้องมีเพื่อ "ถึง" เลเวลนี้พอดี */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 50 * (level - 1) * level;
}

/** เลเวลจาก XP สะสม (inverse ของ xpForLevel) */
export function levelFromXp(xp: number): number {
  if (xp <= 0) return 1;
  return Math.floor((50 + Math.sqrt(2500 + 200 * xp)) / 100);
}

/** ความคืบหน้าในเลเวลปัจจุบัน — ไว้ทำ progress bar บนบัตร/dashboard ต่อไป */
export function levelProgress(xp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  pct: number;
} {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - base;
  const into = xp - base;
  return {
    level,
    xpIntoLevel: into,
    xpForNext: span,
    pct: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 0,
  };
}

interface Row {
  user_id: string;
  messages: number;
  voice_seconds: number;
  xp: number;
  last_message_at: number;
}

const selectStmt = db.prepare<[string], Row>(
  "SELECT * FROM activity WHERE user_id = ?",
);

function toActivity(r: Row): Activity {
  return {
    userId: r.user_id,
    messages: r.messages,
    voiceSeconds: r.voice_seconds,
    xp: r.xp,
    level: levelFromXp(r.xp),
  };
}

/** ข้อมูล activity ของคนคนนั้น (คืนค่าศูนย์ถ้ายังไม่มี) */
export function getActivity(userId: string): Activity {
  const r = selectStmt.get(userId);
  if (!r) return { userId, messages: 0, voiceSeconds: 0, xp: 0, level: 1 };
  return toActivity(r);
}

const upsertMessage = db.prepare<[string, number, number, number, number]>(
  `INSERT INTO activity (user_id, messages, xp, last_message_at)
   VALUES (?, 1, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET
     messages        = messages + 1,
     xp              = xp + ?,
     last_message_at = ?`,
);

/**
 * บันทึกข้อความ 1 ข้อความ — นับจำนวนเสมอ แต่ให้ XP เฉพาะเมื่อพ้น cooldown (กัน spam farm)
 * คืน XpResult (เช็ค .leveledUp เพื่อประกาศเลื่อนเลเวล)
 */
export function recordMessage(userId: string, now: number = Date.now()): XpResult {
  const r = selectStmt.get(userId);
  const oldXp = r?.xp ?? 0;
  const cooldownPassed =
    !r || now - r.last_message_at >= config.activity.messageCooldownMs;
  const gained = cooldownPassed ? config.activity.messageXp : 0;
  const stampAt = cooldownPassed ? now : (r?.last_message_at ?? 0);
  upsertMessage.run(userId, gained, stampAt, gained, stampAt);
  return xpResult(userId, oldXp, gained);
}

const upsertVoice = db.prepare<[string, number, number, number, number]>(
  `INSERT INTO activity (user_id, voice_seconds, xp)
   VALUES (?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET
     voice_seconds = voice_seconds + ?,
     xp            = xp + ?`,
);

/** เพิ่มเวลาห้องเสียง (วินาที) + XP ตามอัตรา voiceXpPerMin — คืน XpResult */
export function addVoiceTime(userId: string, seconds: number): XpResult {
  const s = Math.floor(seconds);
  const r = selectStmt.get(userId);
  const oldXp = r?.xp ?? 0;
  if (s <= 0) return xpResult(userId, oldXp, 0);
  const xp = Math.floor((s * config.activity.voiceXpPerMin) / 60);
  upsertVoice.run(userId, s, xp, s, xp);
  return xpResult(userId, oldXp, xp);
}

/** อันดับ XP สูงสุด (สำหรับ leaderboard / โปรไฟล์) */
export function topByXp(limit = 10): Activity[] {
  const rows = db
    .prepare<[number], Row>("SELECT * FROM activity ORDER BY xp DESC LIMIT ?")
    .all(limit);
  return rows.map(toActivity);
}

/** อันดับเวลาห้องเสียงสูงสุด */
export function topByVoice(limit = 10): Activity[] {
  const rows = db
    .prepare<[number], Row>(
      "SELECT * FROM activity ORDER BY voice_seconds DESC LIMIT ?",
    )
    .all(limit);
  return rows.map(toActivity);
}
