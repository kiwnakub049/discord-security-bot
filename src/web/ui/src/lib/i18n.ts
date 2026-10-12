/**
 * สองภาษา (ไทย/อังกฤษ) — ใช้ข้อความไทยเป็น key ตรง ๆ
 *
 *   t("รอดำเนินการ")                 → "Pending" (ตอนเป็น en)
 *   t("รอ {n} นาที", { n: 5 })       → "Waiting 5 min"
 *
 * เลือกภาษาครั้งเดียวตอนโหลดหน้า เปลี่ยนภาษา = reload ทั้งหน้า
 * (เลยใช้ t() ได้ทุกที่ ทั้งใน component และไฟล์ lib ธรรมดา ไม่ต้องมี hook/context)
 *
 * คำแปลอยู่ใน ../i18n/*.ts — key ไหนไม่มีคำแปล = โชว์ไทยเดิม (test/i18n.test.ts คอยจับ)
 */
import { EN } from "../i18n";

export type Lang = "th" | "en";

const KEY = "ui.lang";

function detect(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "th" || v === "en") return v;
  } catch {
    /* private mode — ใช้ภาษาเครื่อง */
  }
  return typeof navigator !== "undefined" && !navigator.language?.toLowerCase().startsWith("th") ? "en" : "th";
}

export const lang: Lang = typeof window === "undefined" ? "th" : detect();
/** locale ของ Intl (วันที่/ตัวเลข) */
export const locale = lang === "en" ? "en-GB" : "th-TH";

/** ตั้ง lang ให้ <html> (ฟอนต์ Open Sans ผูกกับ :root[lang="en"]) + cookie ให้ server แปลข้อความตอบกลับ */
export function applyLang(): void {
  document.documentElement.lang = lang;
  document.cookie = `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ไม่มีที่เก็บ — ใช้ได้แค่รอบนี้ */
  }
  document.cookie = `lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  location.reload();
}

/**
 * คำไทยเดียวกันที่อังกฤษต้องต่างกันตามที่ใช้ — ต่อท้าย key ด้วย "@@บริบท" (ไทยตัดทิ้งตอนโชว์)
 * เช่น t("ปิด@@server") = "ปิด" / "Stop" ขณะที่ t("ปิด") = "ปิด" / "Close"
 */
export function t(th: string, vars?: Record<string, string | number>): string {
  let s = lang === "en" ? (EN[th] ?? th.split("@@")[0]!) : th.split("@@")[0]!;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}
