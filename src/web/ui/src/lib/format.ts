/** ฟังก์ชันแปลงค่าให้อ่านง่ายที่ใช้ซ้ำหลายหน้า (ตามภาษาที่เลือก) */
import { locale, t } from "./i18n";

const time = new Intl.DateTimeFormat(locale, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayShort = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "short",
});

export const fmtTime = (ms: number): string => time.format(ms);
/** ชั่วโมง:นาที — ใช้กับคอลัมน์เวลาในรายการ (วินาทีอยู่ในรายละเอียดตอนกางแถว) */
export const fmtClock = (ms: number): string => clock.format(ms);
export const fmtDateTime = (ms: number): string => dateTime.format(ms);
export const fmtDay = (ms: number): string => dayShort.format(ms);

/** ตัวเลขคั่นหลักพัน */
export const fmtNum = (n: number): string => n.toLocaleString(locale);

/** "3 นาทีที่แล้ว" — สำหรับ log ที่เพิ่งเข้ามา */
export function fmtAgo(ms: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return t("เมื่อครู่");
  const min = Math.round(sec / 60);
  if (min < 60) return t("{n} นาทีที่แล้ว", { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("{n} ชม.ที่แล้ว", { n: hr });
  return t("{n} วันที่แล้ว", { n: Math.round(hr / 24) });
}

/** ช่วงเวลาเป็นคำอ่าน เช่น "2 วัน 3 ชม." — ใช้กับ uptime และเวลาในห้องเสียง */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return t("{d} วัน {h} ชม.", { d, h });
  if (h) return t("{h} ชม. {m} น.", { h, m });
  if (m) return t("{m} นาที", { m });
  return t("{s} วิ", { s });
}

/** ขนาดหน่วยความจำจาก MB เป็นข้อความสั้น */
export function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
