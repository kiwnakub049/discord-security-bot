import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { LOG_TREE, toggleLevel, type LogFilter, type TreePick } from "../lib/logTree";
import type { LogLevel } from "../lib/types";
import { t } from "../lib/i18n";

/**
 * ต้นไม้หมวดหมู่ของ log
 *
 * ใช้ทั้งในเมนูซ้าย (จอใหญ่) และบนสุดของหน้า Logs (มือถือ) — โครงเดียวกัน
 * ต่างแค่ขนาดตัวอักษรกับระยะห่าง ซึ่งคุมด้วย prop compact
 *
 * หมวดที่ไม่มีกิ่งย่อย (พาร์ทเนอร์ / ระบบ) เป็นปุ่มเดี่ยว ไม่มีลูกศรกาง —
 * ลูกศรที่กดแล้วไม่มีอะไรโผล่ทำให้คนคิดว่าเว็บพัง
 */
export function LogTree({
  filter,
  onPick,
  compact = false,
}: {
  filter: TreePick;
  onPick: (f: TreePick) => void;
  compact?: boolean;
}) {
  // กางหมวดที่กำลังเลือกอยู่ให้เอง เวลากลับเข้าหน้ามาจะได้เห็นว่าอยู่ตรงไหน
  const [open, setOpen] = useState<string | null>(filter.category || null);
  useEffect(() => {
    if (filter.category) setOpen(filter.category);
  }, [filter.category]);

  /*
   * ตัวอักษรเล็กกว่าเมนูหลักหนึ่งขั้น — จำเป็นเพราะในแถบซ้ายมีคำว่า "สมาชิก"
   * สองที่: หมวดของ log (ในต้นไม้) กับหน้าสมาชิก (เมนูหลัก) ถ้าขนาดเท่ากันหมด
   * จะดูเหมือนเมนูซ้ำกันสองอัน แทนที่จะเป็นของคนละชั้น
   */
  const rowBase = compact
    ? "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px]"
    : "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm";

  const isAll = filter.category === "" && filter.leaf === "";

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => onPick({ category: "", leaf: "" })}
        aria-current={isAll ? "true" : undefined}
        className={`press ${rowBase} font-medium ${
          isAll ? "bg-accent-soft text-accent" : "text-muted"
        }`}
      >
        <Icon name="list" className={compact ? "size-4 shrink-0" : "size-[18px] shrink-0"} />
        {t("ทั้งหมด")}
      </button>

      {LOG_TREE.map((node) => {
        const expanded = open === node.category;
        const nodeActive = filter.category === node.category && !filter.leaf;
        const hasLeaves = node.leaves.length > 0;

        return (
          <div key={node.category}>
            <button
              type="button"
              onClick={() => {
                onPick({ category: node.category, leaf: "" });
                if (hasLeaves) setOpen(expanded ? null : node.category);
              }}
              aria-expanded={hasLeaves ? expanded : undefined}
              aria-current={nodeActive ? "true" : undefined}
              className={`press ${rowBase} font-medium ${
                nodeActive ? "bg-accent-soft text-accent" : "text-muted"
              }`}
            >
              <Icon name={node.icon} className={compact ? "size-4 shrink-0" : "size-[18px] shrink-0"} />
              <span className="flex-1 text-left">{node.label}</span>
              {hasLeaves && (
                <Icon
                  name="chevron"
                  className={`size-3.5 shrink-0 text-faint transition-transform duration-200 ${
                    expanded ? "rotate-90" : ""
                  }`}
                />
              )}
            </button>

            {hasLeaves && expanded && (
              <div className="fade-in relative mt-0.5 space-y-0.5 pl-4">
                {/* เส้นตั้งบอกว่ากิ่งพวกนี้อยู่ใต้หมวดข้างบน ไม่ใช่รายการแยก */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 left-[19px] top-1 w-px bg-line"
                />
                {node.leaves.map((leaf) => {
                  const active = filter.leaf === leaf.id;
                  return (
                    <button
                      key={leaf.id}
                      type="button"
                      onClick={() =>
                        onPick({ category: node.category, leaf: leaf.id })
                      }
                      aria-current={active ? "true" : undefined}
                      className={`press ${rowBase} pl-6 ${
                        active ? "bg-accent-soft font-medium text-accent" : "text-faint"
                      }`}
                    >
                      <Icon name={leaf.icon} className="size-4 shrink-0" />
                      <span className="text-left">{leaf.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const LEVEL_OPTIONS: { v: LogLevel; label: string; dot: string }[] = [
  { v: "alert", label: t("แจ้งเตือน@@level"), dot: "bg-alert" },
  { v: "warn", label: t("เตือน@@level"), dot: "bg-warn" },
  { v: "info", label: t("ปกติ"), dot: "bg-info" },
];

/** ต้องตรงกับ WINDOWS ใน src/web/routes/logs.ts */
export const WINDOW_OPTIONS = [
  { v: "", label: t("ทุกเวลา") },
  { v: "1h", label: t("1 ชม.") },
  { v: "24h", label: t("24 ชม.") },
  { v: "7d", label: t("7 วัน") },
  { v: "30d", label: t("30 วัน") },
] as const;

/** ช่องติ๊ก — "mixed" = ติ๊กลูกบางตัว (ขีดกลาง) */
function Box({ state }: { state: boolean | "mixed" }) {
  const on = state !== false;
  return (
    <span
      aria-hidden="true"
      className={`flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
        on ? "border-accent bg-accent text-surface" : "border-faint bg-surface"
      }`}
    >
      {state === true && <Icon name="check" className="size-3.5" />}
      {state === "mixed" && <span className="h-0.5 w-2.5 rounded-full bg-current" />}
    </span>
  );
}

function CheckRow({
  state,
  onToggle,
  children,
  className = "",
  inline = false,
}: {
  state: boolean | "mixed";
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  /** วางเรียงกันในบรรทัดเดียว (ระดับ) แทนที่จะเต็มแถว */
  inline?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "mixed" ? "mixed" : state}
      onClick={onToggle}
      // สูงอย่างน้อย 36px ให้นิ้วกดโดนบนมือถือ
      className={`press flex min-h-9 ${inline ? "pr-3" : "w-full"} items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-raised ${className}`}
    >
      <Box state={state} />
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="px-2 text-xs font-semibold text-faint">{title}</div>
      {children}
    </div>
  );
}

/**
 * แผงตัวกรองแบบติ๊ก — ระดับติ๊กได้หลายช่อง, ช่วงเวลาเลือกทีละอัน
 * หมวด/กิ่งไม่อยู่ในนี้ เลือกจากต้นไม้ข้างบนแทน · ไม่ติ๊กระดับเลย = ทุกระดับ
 */
export function LogFilterPanel({
  filter,
  onChange,
}: {
  filter: LogFilter;
  onChange: (f: LogFilter) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Group title={t("ระดับ")}>
        <div className="flex flex-wrap gap-x-1">
          {LEVEL_OPTIONS.map((l) => (
            <CheckRow
              key={l.v}
              state={filter.levels.includes(l.v)}
              onToggle={() => onChange(toggleLevel(filter, l.v))}
              inline
            >
              <span className={`size-2 shrink-0 rounded-full ${l.dot}`} />
              {l.label}
            </CheckRow>
          ))}
        </div>
      </Group>

      <Group title={t("ช่วงเวลา")}>
        <div className="flex flex-wrap gap-1.5 px-2" role="radiogroup" aria-label={t("ช่วงเวลา")}>
          {WINDOW_OPTIONS.map((w) => {
            const on = filter.window === w.v;
            return (
              <button
                key={w.v}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ ...filter, window: w.v })}
                className={`press rounded-md border px-2.5 py-1 text-sm transition-colors ${
                  on
                    ? "border-accent bg-accent-soft font-semibold text-accent"
                    : "border-line bg-surface text-muted hover:text-text"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </Group>
    </div>
  );
}
