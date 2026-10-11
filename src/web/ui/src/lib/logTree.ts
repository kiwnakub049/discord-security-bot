/**
 * ต้นไม้หมวดหมู่ของหน้า Logs — จุดเดียวที่ต้องแก้เวลาอยากเพิ่ม/ลดกิ่ง
 *
 * โครงเป็นสองชั้น: หมวด (ตรงกับ category ใน DB) → กิ่งย่อย (ตรงกับ event)
 * ติ๊กหมวด = เห็นทั้งหมวด, ติ๊กกิ่ง = เห็นเฉพาะ event ที่กิ่งนั้นระบุ (ติ๊กหลายอันพร้อมกันได้)
 *
 * กิ่งหนึ่งระบุได้หลาย event เพราะบางเรื่องที่คนมองว่าเป็นเรื่องเดียวกัน
 * ถูกเก็บเป็นคนละ event เช่น "เข้า-ออกเซิร์ฟเวอร์" = member_join + member_leave
 *
 * ── ตอนนี้เอาเฉพาะกิ่งที่ใช้จริงก่อน ──
 * event อย่าง security_spam / security_raid / voice_camera มีในโค้ดแล้วแต่ยังไม่เคยเกิด
 * เลยยังไม่ทำเป็นกิ่ง — ติ๊กหมวดแม่ก็เห็นอยู่ดีถ้ามันเกิดขึ้น
 * ถ้าวันไหนเริ่มเจอบ่อยค่อยเพิ่มบรรทัดลงมาที่นี่
 */
import type { IconName } from "../components/Icon";
import type { LogCategory, LogLevel } from "./types";
import { CATEGORY_ICON, CATEGORY_LABEL } from "./categories";

export interface TreeLeaf {
  /** ใช้เป็นคีย์และเก็บใน URL — ต้องไม่ซ้ำกันทั้งต้นไม้ */
  id: string;
  label: string;
  icon: IconName;
  /** event ที่กิ่งนี้ครอบคลุม */
  events: string[];
}

export interface TreeNode {
  category: LogCategory;
  label: string;
  icon: IconName;
  leaves: TreeLeaf[];
}

const node = (category: LogCategory, leaves: TreeLeaf[]): TreeNode => ({
  category,
  label: CATEGORY_LABEL[category],
  icon: CATEGORY_ICON[category],
  leaves,
});

export const LOG_TREE: TreeNode[] = [
  node("security", [
    { id: "ai", label: "AI จับข้อความ toxic / spam", icon: "message", events: ["security_ai"] },
    { id: "warn", label: "เตือนสมาชิก", icon: "warn", events: ["security_warn"] },
  ]),
  node("member", [
    {
      id: "join-leave",
      label: "เข้า-ออกเซิร์ฟเวอร์",
      icon: "logout",
      events: ["member_join", "member_leave"],
    },
    { id: "card", label: "สร้างบัตรสมาชิก", icon: "user", events: ["member_register"] },
  ]),
  node("voice", [
    {
      id: "room",
      label: "เข้า-ออกห้อง",
      icon: "volume",
      events: ["voice_join", "voice_leave"],
    },
    { id: "move", label: "ย้ายห้อง", icon: "refresh", events: ["voice_move"] },
    // เฉพาะ "ขาปิด" เท่านั้น — ขาเปิดอยู่ voice_mute_off / voice_deafen_off
    { id: "mic", label: "ไมค์แดง", icon: "mic-off", events: ["voice_mute_on"] },
    { id: "deaf", label: "หูแดง", icon: "headphone-off", events: ["voice_deafen_on"] },
  ]),
  node("audit", [
    {
      id: "ban",
      label: "แบน-หมดเวลา",
      icon: "ban",
      events: ["audit_ban", "audit_unban", "audit_timeout", "audit_kick"],
    },
    { id: "role", label: "จัดการยศ (บทบาท)", icon: "key", events: ["audit_role"] },
    {
      id: "channel-del",
      label: "ลบห้อง",
      icon: "x",
      events: ["audit_channel_delete"],
    },
  ]),
  node("partner", []),
  node("system", []),
];

/** หา leaf จาก id — คืน null ถ้าไม่มี (เช่น id เก่าค้างอยู่ใน URL) */
export function findLeaf(leafId: string | null): TreeLeaf | null {
  if (!leafId) return null;
  for (const n of LOG_TREE) {
    const found = n.leaves.find((l) => l.id === leafId);
    if (found) return found;
  }
  return null;
}

/**
 * ตัวกรองที่ติ๊กอยู่ — ทุกช่องว่าง = ดูทุกอย่าง
 *
 * หมวดที่อยู่ใน categories = ติ๊กทั้งหมวด (รวม event ที่ไม่มีกิ่งของตัวเองด้วย)
 * ถ้าติ๊กแค่บางกิ่ง หมวดนั้นจะไม่อยู่ใน categories แต่กิ่งไปอยู่ใน leaves แทน
 * สองอย่างนี้ไม่ซ้อนกัน — ติ๊กทั้งหมวดแล้วกิ่งของหมวดนั้นจะถูกล้างออกจาก leaves
 */
export interface LogFilter {
  categories: LogCategory[];
  leaves: string[];
  levels: LogLevel[];
  /** ช่วงเวลาย้อนหลัง — "" = ทุกเวลา (เลือกได้ทีละอัน ติ๊กหลายช่วงไม่มีความหมาย) */
  window: string;
}

export const EMPTY_FILTER: LogFilter = { categories: [], leaves: [], levels: [], window: "" };

const nodeOf = (category: LogCategory) => LOG_TREE.find((n) => n.category === category);

/** สถานะช่องติ๊กของหมวด — "some" = ติ๊กบางกิ่ง (ช่องขีดกลาง) */
export function categoryState(f: LogFilter, category: LogCategory): "all" | "some" | "none" {
  if (f.categories.includes(category)) return "all";
  const ids = nodeOf(category)?.leaves.map((l) => l.id) ?? [];
  return ids.some((id) => f.leaves.includes(id)) ? "some" : "none";
}

export function leafChecked(f: LogFilter, category: LogCategory, leafId: string): boolean {
  return f.categories.includes(category) || f.leaves.includes(leafId);
}

/** ติ๊กหมวด: ติ๊กครบอยู่แล้ว → เอาออกทั้งหมวด · ไม่ครบ/ไม่ได้ติ๊ก → ติ๊กทั้งหมวด */
export function toggleCategory(f: LogFilter, category: LogCategory): LogFilter {
  const ids = new Set(nodeOf(category)?.leaves.map((l) => l.id) ?? []);
  const leaves = f.leaves.filter((id) => !ids.has(id));
  const categories = f.categories.filter((c) => c !== category);
  if (!f.categories.includes(category)) categories.push(category);
  return { ...f, categories, leaves };
}

/**
 * ติ๊กกิ่ง — ถ้าหมวดถูกติ๊กทั้งหมวดอยู่ การเอากิ่งออกหนึ่งอัน = เหลือกิ่งอื่นครบ
 * ติ๊กจนครบทุกกิ่งเมื่อไร ยุบกลับเป็นติ๊กทั้งหมวดให้เอง (ช่องหมวดจะได้ไม่ค้างเป็นขีดกลาง)
 */
export function toggleLeaf(f: LogFilter, category: LogCategory, leafId: string): LogFilter {
  const node = nodeOf(category);
  if (!node) return f;
  const ids = node.leaves.map((l) => l.id);
  let picked = new Set(
    f.categories.includes(category) ? ids : ids.filter((id) => f.leaves.includes(id)),
  );
  if (picked.has(leafId)) picked.delete(leafId);
  else picked.add(leafId);

  const others = f.leaves.filter((id) => !ids.includes(id));
  const categories = f.categories.filter((c) => c !== category);
  if (picked.size === ids.length) {
    categories.push(category);
    picked = new Set();
  }
  return { ...f, categories, leaves: [...others, ...picked] };
}

export function toggleLevel(f: LogFilter, level: LogLevel): LogFilter {
  const levels = f.levels.includes(level)
    ? f.levels.filter((l) => l !== level)
    : [...f.levels, level];
  return { ...f, levels };
}

/** event ทั้งหมดของกิ่งที่ติ๊กอยู่ (ไม่รวมหมวดที่ติ๊กทั้งหมวด — อันนั้นส่งเป็น category) */
export function pickedEvents(f: LogFilter): string[] {
  return [...new Set(f.leaves.flatMap((id) => findLeaf(id)?.events ?? []))];
}

/** query string ของ /api/logs (ไม่มี ? นำหน้า) — หลายค่าต่อด้วยลูกน้ำ */
export function filterParams(f: LogFilter, search = ""): string {
  const q = new URLSearchParams();
  if (f.categories.length) q.set("category", f.categories.join(","));
  const events = pickedEvents(f);
  if (events.length) q.set("event", events.join(","));
  if (f.levels.length) q.set("level", f.levels.join(","));
  if (f.window) q.set("window", f.window);
  if (search) q.set("search", search);
  return q.toString();
}

/** log ใหม่จากสตรีมสดผ่านตัวกรองไหม — ต้องตรงกับที่ server กรอง (หมวด หรือ event, และระดับ) */
export function matchesFilter(
  e: { category: LogCategory; event: string; level: LogLevel },
  f: LogFilter,
): boolean {
  if (f.levels.length && !f.levels.includes(e.level)) return false;
  const events = pickedEvents(f);
  if (!f.categories.length && !events.length) return true;
  return f.categories.includes(e.category) || events.includes(e.event);
}

/** จำนวนตัวกรองที่ติ๊กอยู่ — โชว์บนปุ่ม "ตัวกรอง" */
export function activeCount(f: LogFilter): number {
  return f.categories.length + f.leaves.length + f.levels.length + (f.window ? 1 : 0);
}

/** อ่านค่าที่จำไว้ — ค่าเก่า/เสีย/กิ่งที่ถูกลบไปแล้ว ทิ้งไปเงียบ ๆ */
export function parseFilter(raw: unknown): LogFilter {
  if (!raw || typeof raw !== "object") return EMPTY_FILTER;
  const o = raw as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const cats = new Set(LOG_TREE.map((n) => n.category as string));
  return {
    categories: arr(o.categories).filter((c) => cats.has(c)) as LogCategory[],
    leaves: arr(o.leaves).filter((id) => findLeaf(id)),
    levels: arr(o.levels).filter((l) => ["info", "warn", "alert"].includes(l)) as LogLevel[],
    window: typeof o.window === "string" && ["1h", "24h", "7d", "30d"].includes(o.window)
      ? o.window
      : "",
  };
}
