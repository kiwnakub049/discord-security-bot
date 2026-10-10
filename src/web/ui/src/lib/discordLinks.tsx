import type { ReactNode } from "react";
import { channelUrl, userUrl, type LinkTarget } from "./linkTarget";

/**
 * ทำให้ค่าใน log กดได้ — ชื่อห้องกระโดดไปห้องนั้น, id คนกระโดดไปโปรไฟล์
 *
 * ทำไมต้องมี: ตอนสืบเรื่อง สิ่งที่อยากทำต่อจากการอ่าน log คือ "ไปดูห้องนั้น"
 * หรือ "ไปดูคนนั้น" ถ้าต้องคัดลอก id ไปวางในช่องค้นหาของ Discord เองทุกครั้ง
 * มันช้าพอที่จะทำให้คนเลิกสืบกลางคัน
 *
 * ปลายทางเป็น https หรือ discord:// ขึ้นกับที่ตั้งไว้ในหน้าตั้งค่า (ดู linkTarget.ts)
 */

/** id ของ Discord (snowflake) — 17–20 หลัก */
const SNOWFLAKE = /\b(\d{17,20})\b/g;

/** timestamp ของ Discord: <t:วินาที:R|f|F|t|T|d|D> — เลข 10 หลัก ไม่ชน snowflake */
const TIMESTAMP = /<t:(\d+):([tTdDfFR])>/g;

/** ระยะเวลาสัมพัทธ์เป็นไทย เช่น "อีก 58 นาที" / "3 ชั่วโมงที่แล้ว" */
function relThai(ms: number): string {
  const s = Math.round(ms / 1000);
  const abs = Math.abs(s);
  let v: number;
  let unit: string;
  if (abs < 60) [v, unit] = [abs, "วินาที"];
  else if (abs < 3600) [v, unit] = [Math.round(abs / 60), "นาที"];
  else if (abs < 86400) [v, unit] = [Math.round(abs / 3600), "ชั่วโมง"];
  else [v, unit] = [Math.round(abs / 86400), "วัน"];
  return s >= 0 ? `อีก ${v} ${unit}` : `${v} ${unit}ที่แล้ว`;
}

/**
 * แปลง token timestamp ของ Discord เป็นข้อความไทยอ่านออก
 * (Discord เรนเดอร์ให้เองในแอป แต่บนเว็บต้องแปลงเอง ไม่งั้นเห็นเป็น <t:...> ดิบ)
 * คำนวณตอนเรนเดอร์ → อัปเดตทุกครั้งที่ log refresh เหมือนนับถอยหลังคร่าว ๆ
 */
export function humanizeTimestamps(value: string): string {
  return value.replace(TIMESTAMP, (_all, sec: string, style: string) => {
    const ms = Number(sec) * 1000;
    if (style === "R") return relThai(ms - Date.now());
    const d = new Date(ms);
    return style === "t" || style === "T"
      ? d.toLocaleTimeString("th-TH", { hour12: false })
      : d.toLocaleString("th-TH", { hour12: false });
  });
}

/** ช่องที่ค่าข้างในเป็น "ห้อง" ไม่ใช่ "คน" — ต้องตรงกับ CHANNEL_FIELDS ใน logger.ts */
const CHANNEL_FIELDS = new Set(["ห้อง", "จาก", "ไป", "ห้องเสียง"]);

function Link({
  href,
  target,
  children,
}: {
  href: string;
  target: LinkTarget;
  children: ReactNode;
}) {
  /*
   * discord:// เปิดแท็บใหม่ไม่ได้ — เบราว์เซอร์จะเหลือแท็บว่างค้างไว้
   * ส่วน https เปิดแท็บใหม่ดีกว่า เพราะไม่อยากให้ dashboard ที่เปิดค้างหายไป
   */
  const newTab = target === "browser";
  return (
    <a
      href={href}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-accent underline decoration-dotted underline-offset-2"
    >
      {children}
    </a>
  );
}

/**
 * แปลงค่าหนึ่งช่องเป็น element ที่กดได้
 *
 * ช่องประเภทห้อง: ชื่อห้องกลายเป็นลิงก์ ส่วน (id) ต่อท้ายปล่อยเป็นข้อความไว้
 * ให้คัดลอกได้ ช่องอื่น: หา id ทุกตัวในข้อความแล้วทำให้แต่ละตัวกดได้
 *
 * log เก่าที่บันทึกก่อนมีการเก็บ id จะไม่มีอะไรให้ลิงก์ — คืนข้อความเดิมไป
 */
export function linkifyField(
  fieldName: string,
  value: string,
  guildId: string | null,
  target: LinkTarget,
): ReactNode {
  // แปลง timestamp ของ Discord ให้อ่านออกก่อนเสมอ (channel field ไม่มี token นี้อยู่แล้ว)
  value = humanizeTimestamps(value);
  if (!guildId) return value;

  if (CHANNEL_FIELDS.has(fieldName)) {
    const m = /^(.*?)\s*\((\d{17,20})\)\s*$/.exec(value);
    if (!m) return value; // ไม่มี id (log เก่า) — ปล่อยเป็นข้อความ
    const [, name, channelId] = m;
    return (
      <>
        <Link href={channelUrl(guildId, channelId!, target)} target={target}>
          {name}
        </Link>{" "}
        <span className="text-faint">({channelId})</span>
      </>
    );
  }

  // ช่องทั่วไป — ทำให้ id ของคนกดได้ทีละตัว
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(SNOWFLAKE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(value.slice(last, at));
    parts.push(
      <Link key={`${at}-${m[1]}`} href={userUrl(m[1]!, target)} target={target}>
        {m[1]}
      </Link>,
    );
    last = at + m[1]!.length;
  }
  if (parts.length === 0) return value;
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}
