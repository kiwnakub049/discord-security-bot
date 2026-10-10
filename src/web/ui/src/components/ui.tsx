/** ชิ้นส่วนเล็ก ๆ ที่ใช้ซ้ำทุกหน้า — รวมไว้ไฟล์เดียวเพราะแต่ละอันสั้นมาก */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * แผ่นงาน — พื้น surface ขอบเส้นฟอร์ม มุมโค้งเล็ก
 *
 * level ยังรับค่าเดิมได้ (pane/glass/glass-strong) เพื่อไม่ต้องแก้ทุกหน้า
 * "pane" ข้ามการวาดตอนอยู่นอกจอ — ใช้กับการ์ดในรายการยาว ๆ
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
  return <div className={`${level} rounded-md ${className}`}>{children}</div>;
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex min-h-9 items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/**
 * แถวตัวเลขสรุป — แผ่นเดียว แบ่งช่องด้วยเส้นฟอร์ม
 *
 * แทนการ์ดสี่ใบหน้าตาเหมือนกันแบบเดิม: ตัวเลขพวกนี้เป็น "สถานะประกอบ" ไม่ใช่งานที่ต้องทำ
 * เลยไม่ควรแย่งสายตากับแถบรอดำเนินการที่อยู่ข้างบน
 * สีสัญญาณขึ้นเฉพาะช่องที่มีเรื่องจริง (tone) ช่องปกติเป็นสีหมึก
 */
export function StatStrip({
  items,
}: {
  items: {
    label: string;
    value: ReactNode;
    sub?: ReactNode;
    tone?: "plain" | "warn" | "alert";
  }[];
}) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface md:grid-cols-4">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`border-line px-4 py-3.5 ${i % 2 === 1 ? "border-l" : ""} ${
            i >= 2 ? "border-t md:border-t-0" : ""
          } ${i === 2 ? "md:border-l" : ""}`}
        >
          <dt className="text-sm text-muted">{it.label}</dt>
          <dd
            className={`tnum text-2xl font-semibold leading-tight ${
              it.tone === "alert" ? "text-alert" : it.tone === "warn" ? "text-warn" : ""
            }`}
          >
            {it.value}
          </dd>
          {it.sub && <dd className="truncate text-xs text-faint">{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** ปุ่มกรอง — แถวเดียวเลื่อนซ้ายขวาได้บนมือถือ */
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
      className={`press shrink-0 rounded-md border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-accent bg-accent-soft font-semibold text-accent"
          : "border-line bg-surface text-muted hover:text-text"
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
    plain: "border-line bg-surface text-text hover:bg-raised",
    accent: "border-accent bg-accent text-surface",
    danger: "border-alert/50 bg-surface text-alert hover:bg-alert-soft",
    ghost: "border-transparent text-muted",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-3.5 py-2 text-sm font-medium transition disabled:opacity-40 ${cls} ${
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
        className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-9 text-base outline-none transition-colors placeholder:text-faint focus:border-accent"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="ล้างคำค้น"
          className="press absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint"
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

/** แถบความคืบหน้า — ใช้ทั้งเลเวล XP และการใช้ RAM/ดิสก์ (แถบทึบเรียบ ๆ ไม่ไล่สี) */
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
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-raised">
      <div
        className="h-full rounded-sm transition-[width] duration-500 [transition-timing-function:var(--ease-out-soft)]"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}
