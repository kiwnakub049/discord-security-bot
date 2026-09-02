/** ชิ้นส่วนเล็ก ๆ ที่ใช้ซ้ำทุกหน้า — รวมไว้ไฟล์เดียวเพราะแต่ละอันสั้นมาก */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * การ์ด — เลือกระดับกระจกได้
 *
 * ค่าเริ่มต้นคือ "pane" (เบลอ 10px + ข้ามการวาดตอนอยู่นอกจอ) เพราะการ์ดส่วนใหญ่
 * อยู่ในรายการยาว ๆ ใช้ "glass" เฉพาะใบที่มีจำนวนคงที่และอยู่เหนือครึ่งจอ
 */
export function Card({
  children,
  className = "",
  level = "pane",
}: {
  children: ReactNode;
  className?: string;
  level?: "pane" | "glass" | "glass-strong";
}) {
  return (
    <div className={`${level} rounded-2xl ${className}`}>{children}</div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <h2 className="text-sm font-semibold text-muted">{children}</h2>
      {action}
    </div>
  );
}

/** ตัวเลขใหญ่หนึ่งค่าพร้อมป้ายกำกับ — หัวใจของหน้าแรกบนมือถือ */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  tone?: "plain" | "info" | "warn" | "alert" | "ok";
}) {
  const toneClass = {
    plain: "text-text",
    info: "text-info",
    warn: "text-warn",
    alert: "text-alert",
    ok: "text-ok",
  }[tone];

  return (
    <Card level="glass" className="glass-lift p-4">
      <div className="flex items-center gap-1.5 text-muted">
        {icon && <Icon name={icon} className="size-4" />}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className={`tnum mt-1.5 text-3xl font-bold leading-none ${toneClass}`}>
        {value}
      </div>
      {sub && <div className="mt-1.5 truncate text-xs text-faint">{sub}</div>}
    </Card>
  );
}

/** ปุ่มกรองแบบเม็ดยา — แถวเดียวเลื่อนซ้ายขวาได้บนมือถือ */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-accent/40 bg-accent-soft text-accent shadow-[inset_0_1px_0_0_var(--glass-spec)]"
          : "border-line bg-surface text-muted shadow-[inset_0_1px_0_0_var(--glass-spec)]"
      }`}
    >
      {children}
    </button>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    // -mx + px = ให้เม็ดยาตัวแรก/ตัวสุดท้ายเลื่อนชิดขอบจอได้ ไม่ดูเหมือนโดนตัด
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function Badge({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "info" | "warn" | "alert" | "ok" | "accent";
  children: ReactNode;
}) {
  const cls = {
    plain: "bg-raised text-muted",
    info: "bg-info-soft text-info",
    warn: "bg-warn-soft text-warn",
    alert: "bg-alert-soft text-alert",
    ok: "bg-ok-soft text-ok",
    accent: "bg-accent-soft text-accent",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "plain",
  disabled,
  full,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "plain" | "accent" | "danger" | "ghost";
  disabled?: boolean;
  full?: boolean;
  type?: "button" | "submit";
}) {
  const cls = {
    plain: "border-line bg-surface text-text",
    accent: "border-accent/40 bg-accent-soft text-accent",
    danger: "border-alert/40 bg-alert-soft text-alert",
    ghost: "border-transparent text-muted",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-[inset_0_1px_0_0_var(--glass-spec)] transition disabled:opacity-40 ${cls} ${
        full ? "w-full" : ""
      }`}
    >
      {children}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1">
      {/*
        z-10 จำเป็น — ไอคอนอยู่ก่อน input ใน DOM ถ้าไม่ยกขึ้นมา ตัว input
        จะวาดทับจนไอคอนหายไปเลย (เคยเป็นแล้วตอนใส่ backdrop-filter ให้ input
        เพราะมันสร้าง stacking context ใหม่)
      */}
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // 16px ขึ้นไปเท่านั้น — Safari บน iOS จะซูมหน้าเข้าเองถ้าตัวอักษรเล็กกว่านี้
        className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-9 text-base shadow-[inset_0_1px_0_0_var(--glass-spec)] outline-none transition-colors placeholder:text-faint focus:border-accent"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="ล้างคำค้น"
          className="press absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-faint"
        >
          <Icon name="x" className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Empty({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center gap-2 py-12 text-center text-faint">
      <Icon name={icon} className="size-8" />
      <p className="text-sm">{children}</p>
    </div>
  );
}

/**
 * แถบความคืบหน้า — ใช้ทั้งเลเวล XP และการใช้ RAM/ดิสก์
 *
 * ตัวแถบไล่สีจากจางไปเข้มแล้วมีเส้นแสงทับด้านบน ให้ดูเป็นหลอดแก้วมีของเหลวข้างใน
 * ไม่ใช่สี่เหลี่ยมทึบ — เข้าชุดกับกระจกที่เหลือ
 */
export function Meter({
  pct,
  tone = "accent",
}: {
  pct: number;
  tone?: "accent" | "warn" | "alert" | "ok";
}) {
  const color = {
    accent: "var(--c-accent)",
    warn: "var(--c-warn)",
    alert: "var(--c-alert)",
    ok: "var(--c-ok)",
  }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-raised shadow-[inset_0_1px_2px_0_var(--glass-shade)]">
      <div
        className="h-full rounded-full transition-[width] duration-700 [transition-timing-function:var(--ease-spring)]"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: `linear-gradient(180deg, color-mix(in srgb, ${color} 70%, white), ${color})`,
          boxShadow: `0 0 10px -2px ${color}`,
        }}
      />
    </div>
  );
}
