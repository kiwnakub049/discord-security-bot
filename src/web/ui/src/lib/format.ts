/** ฟังก์ชันแปลงค่าให้อ่านง่ายแบบไทย ๆ ที่ใช้ซ้ำหลายหน้า */

const time = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dateTime = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayShort = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
});

export const fmtTime = (ms: number): string => time.format(ms);
export const fmtDateTime = (ms: number): string => dateTime.format(ms);
export const fmtDay = (ms: number): string => dayShort.format(ms);

/** ตัวเลขคั่นหลักพัน */
export const fmtNum = (n: number): string => n.toLocaleString("th-TH");

/** "3 นาทีที่แล้ว" — สำหรับ log ที่เพิ่งเข้ามา */
export function fmtAgo(ms: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return "เมื่อครู่";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  return `${Math.round(hr / 24)} วันที่แล้ว`;
}

/** ช่วงเวลาเป็นคำอ่าน เช่น "2 วัน 3 ชม." — ใช้กับ uptime และเวลาในห้องเสียง */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} วัน ${h} ชม.`;
  if (h) return `${h} ชม. ${m} น.`;
  if (m) return `${m} นาที`;
  return `${s} วิ`;
}

/** ขนาดหน่วยความจำจาก MB เป็นข้อความสั้น */
export function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
