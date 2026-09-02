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
import type { LogCategory } from "./types";
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
    { id: "ai", label: "AI จับข้อความ toxic", icon: "message", events: ["security_ai"] },
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

/** ตัวกรองที่กำลังเลือกอยู่ — ว่างทั้งคู่ = ดูทุกอย่าง */
export interface LogFilter {
  category: LogCategory | "";
  leaf: string;
}

export const EMPTY_FILTER: LogFilter = { category: "", leaf: "" };
