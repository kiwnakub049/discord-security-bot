/**
 * ต้นไม้หมวดหมู่ของหน้า Logs — จุดเดียวที่ต้องแก้เวลาอยากเพิ่ม/ลดกิ่ง
 *
 * โครงเป็นสองชั้น: หมวด (ตรงกับ category ใน DB) → กิ่งย่อย (ตรงกับ event)
 * กดที่หมวด = เห็นทั้งหมวด, กดที่กิ่ง = เห็นเฉพาะ event ที่กิ่งนั้นระบุ
 *
 * กิ่งหนึ่งระบุได้หลาย event เพราะบางเรื่องที่คนมองว่าเป็นเรื่องเดียวกัน
 * ถูกเก็บเป็นคนละ event เช่น "เข้า-ออกเซิร์ฟเวอร์" = member_join + member_leave
 *
 * ── ตอนนี้เอาเฉพาะกิ่งที่ใช้จริงก่อน ──
 * event อย่าง security_spam / security_raid / voice_camera มีในโค้ดแล้วแต่ยังไม่เคยเกิด
 * เลยยังไม่ทำเป็นกิ่ง — กดที่หมวดแม่ก็เห็นอยู่ดีถ้ามันเกิดขึ้น
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
    // ตรวจข้อความด้วย Claude แล้ว — ชื่อ event ยังเป็น security_ai เดิม log เก่าจะได้ขึ้นกิ่งเดียวกัน
    { id: "ai", label: "Logs Claude", icon: "message", events: ["security_ai"] },
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

/** สิ่งที่เลือกจากต้นไม้ — ว่างทั้งคู่ = ทุกหมวด */
export interface TreePick {
  category: LogCategory | "";
  leaf: string;
}

/**
 * ตัวกรองของหน้า Logs
 * - หมวด/กิ่ง: เลือกจากต้นไม้ทีละอันแบบเดิม (เมนูซ้ายบนจอใหญ่, ปุ่มกางบนมือถือ)
 * - ระดับ: ติ๊กได้หลายช่องในแผงตัวกรอง · ช่วงเวลา: เลือกได้ทีละอัน
 */
export interface LogFilter extends TreePick {
  levels: LogLevel[];
  /** ช่วงเวลาย้อนหลัง — "" = ทุกเวลา */
  window: string;
}

export const EMPTY_FILTER: LogFilter = { category: "", leaf: "", levels: [], window: "" };

export function toggleLevel(f: LogFilter, level: LogLevel): LogFilter {
  const levels = f.levels.includes(level)
    ? f.levels.filter((l) => l !== level)
    : [...f.levels, level];
  return { ...f, levels };
}

/**
 * query string ของ /api/logs (ไม่มี ? นำหน้า)
 * เลือกกิ่ง → ส่งแค่ event ของกิ่ง (แคบกว่าหมวดอยู่แล้ว) · เลือกแค่หมวด → ส่งหมวด
 */
export function filterParams(f: LogFilter, search = ""): string {
  const q = new URLSearchParams();
  const leaf = findLeaf(f.leaf);
  if (leaf) q.set("event", leaf.events.join(","));
  else if (f.category) q.set("category", f.category);
  if (f.levels.length) q.set("level", f.levels.join(","));
  if (f.window) q.set("window", f.window);
  if (search) q.set("search", search);
  return q.toString();
}

/** log ใหม่จากสตรีมสดผ่านตัวกรองไหม — ต้องตรงกับที่ server กรอง */
export function matchesFilter(
  e: { category: LogCategory; event: string; level: LogLevel },
  f: LogFilter,
): boolean {
  if (f.levels.length && !f.levels.includes(e.level)) return false;
  const leaf = findLeaf(f.leaf);
  if (leaf) return leaf.events.includes(e.event);
  return !f.category || e.category === f.category;
}

/** จำนวนช่องที่ติ๊กในแผงตัวกรอง (หมวด/กิ่งไม่นับ — อยู่ในต้นไม้) */
export function activeCount(f: LogFilter): number {
  return f.levels.length + (f.window ? 1 : 0);
}

/** อ่านค่าที่จำไว้ — ค่าเก่า/เสีย/กิ่งที่ถูกลบไปแล้ว ทิ้งไปเงียบ ๆ */
export function parseFilter(raw: unknown): LogFilter {
  if (!raw || typeof raw !== "object") return EMPTY_FILTER;
  const o = raw as Record<string, unknown>;
  const node = LOG_TREE.find((n) => n.category === o.category);
  const leaf = node?.leaves.find((l) => l.id === o.leaf)?.id ?? "";
  const levels = Array.isArray(o.levels)
    ? (o.levels.filter((l) => ["info", "warn", "alert"].includes(l as string)) as LogLevel[])
    : [];
  return {
    category: node?.category ?? "",
    leaf,
    levels,
    window: typeof o.window === "string" && ["1h", "24h", "7d", "30d"].includes(o.window)
      ? o.window
      : "",
  };
}
