/**
 * ชื่อและไอคอนประจำหมวดของ log — จุดเดียวที่ต้องแก้เวลาอยากเปลี่ยนรูป
 *
 * ไฟล์นี้จงใจไม่ import React เลย เพื่อให้เทสเรียกตรวจได้โดยไม่ต้องลาก
 * คอมโพเนนต์ทั้งชุดมาด้วย
 *
 * ── วิธีเปลี่ยนไอคอน ──
 * 1. เปิด src/web/ui/src/components/Icon.tsx เพิ่มบรรทัดใน PATHS:
 *      ชื่อที่ตั้งเอง: '<path d="…"/><circle …/>',
 *    เอาเฉพาะ "ข้างใน" <svg> มาวาง (ไม่ต้องมีแท็ก <svg> ครอบ)
 *    รูปต้องเป็นแบบเส้น (stroke) บนกรอบ 24×24 และห้ามใส่สีตายตัว —
 *    ทั้งชุดวาดด้วย currentColor เพื่อให้เปลี่ยนสีตามธีมสว่าง/มืดได้เอง
 * 2. กลับมาชี้ชื่อนั้นใน CATEGORY_ICON ข้างล่าง
 */
import type { IconName } from "../components/Icon";
import type { LogCategory } from "./types";

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  security: "ความปลอดภัย",
  member: "สมาชิก",
  voice: "ห้องเสียง",
  audit: "ตรวจสอบ",
  partner: "พาร์ทเนอร์",
  system: "ระบบ",
};

export const CATEGORY_ICON: Record<LogCategory, IconName> = {
  security: "shield-check",
  member: "users",
  voice: "volume",
  audit: "key",
  partner: "bot",
  system: "cpu",
};

/** ทุกหมวด เรียงตามที่อยากให้โชว์ — ต้องตรงกับ LOG_CATEGORIES ฝั่ง server */
export const CATEGORIES: LogCategory[] = [
  "security",
  "member",
  "voice",
  "audit",
  "partner",
  "system",
];

export const labelOf = (c: string): string =>
  CATEGORY_LABEL[c as LogCategory] ?? c;

export const iconOf = (c: string): IconName =>
  CATEGORY_ICON[c as LogCategory] ?? "list";
