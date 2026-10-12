import { useState } from "react";

/**
 * รูปโปรไฟล์ Discord — ดึงผ่าน /api/avatar/<id> (server ส่งต่อไป CDN ของ Discord)
 *
 * ไม่มี id / โหลดรูปไม่ได้ (คนออกจากเซิร์ฟ, บอทไม่ได้ต่อ Discord) → วงกลมอักษรตัวแรกของชื่อ
 * สีของวงกลมสุ่มจากชื่อแบบคงที่ คนเดิมได้สีเดิมทุกครั้ง แยกคนออกได้แม้ไม่มีรูป
 */

const SIZE = {
  xs: "size-5 text-[10px]",
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-11 text-base",
} as const;

const TONES = [
  "bg-accent-soft text-accent",
  "bg-info-soft text-info",
  "bg-warn-soft text-warn",
  "bg-ok-soft text-ok",
  "bg-alert-soft text-alert",
];

function toneOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) | 0;
  return TONES[Math.abs(h) % TONES.length]!;
}

const isSnowflake = (id: string | null | undefined): id is string =>
  !!id && /^\d{15,21}$/.test(id);

export function Avatar({
  id,
  name,
  size = "sm",
  className = "",
}: {
  id?: string | null;
  name: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const base = `inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ${SIZE[size]} ${className}`;

  if (isSnowflake(id) && !failed) {
    return (
      <img
        src={`/api/avatar/${id}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${base} bg-raised object-cover`}
      />
    );
  }
  const letter = [...(name.trim() || "?")][0]!.toUpperCase();
  return (
    <span aria-hidden="true" className={`${base} font-semibold ${toneOf(name)}`}>
      {letter}
    </span>
  );
}

/** ดึง Discord user ID จากค่าแบบ "ชื่อ (123456789012345678)" ที่ log เขียนไว้ */
export function idFromLabel(value: string): string | null {
  return (
    /\((\d{15,21})\)\s*$/.exec(value)?.[1] ?? /^(\d{15,21})$/.exec(value.trim())?.[1] ?? null
  );
}
