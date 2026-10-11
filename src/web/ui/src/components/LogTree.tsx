import type { ReactNode } from "react";
import { Icon } from "./Icon";
import {
  LOG_TREE,
  leavesOf,
  pickCategory,
  toggleLeaf,
  toggleLevel,
  type LogFilter,
} from "../lib/logTree";
import type { LogLevel } from "../lib/types";

/**
 * ตัวกรองของหน้า Logs แบ่งเป็นสองส่วน
 * - CategoryTabs: แถบหมวด เลือกทีละหมวด (แยกออกมา ไม่ปนกับช่องติ๊ก)
 * - LogFilterPanel: ช่องติ๊กหลายช่อง — หัวข้อย่อยของหมวดที่เลือก, ระดับ, และช่วงเวลา
 *   ไม่ติ๊กอะไรเลยในกลุ่มไหน = ไม่กรองด้วยกลุ่มนั้น
 */

export const LEVEL_OPTIONS: { v: LogLevel; label: string; dot: string }[] = [
  { v: "alert", label: "แจ้งเตือน", dot: "bg-alert" },
  { v: "warn", label: "เตือน", dot: "bg-warn" },
  { v: "info", label: "ปกติ", dot: "bg-info" },
];

/** ต้องตรงกับ WINDOWS ใน src/web/routes/logs.ts */
export const WINDOW_OPTIONS = [
  { v: "", label: "ทุกเวลา" },
  { v: "1h", label: "1 ชม." },
  { v: "24h", label: "24 ชม." },
  { v: "7d", label: "7 วัน" },
  { v: "30d", label: "30 วัน" },
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

export function LogFilterPanel({
  filter,
  onChange,
}: {
  filter: LogFilter;
  onChange: (f: LogFilter) => void;
}) {
  const leaves = leavesOf(filter.category);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Group title="ระดับ">
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

        <Group title="ช่วงเวลา">
          <div className="flex flex-wrap gap-1.5 px-2" role="radiogroup" aria-label="ช่วงเวลา">
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

      {leaves.length > 0 && (
        <Group title="หัวข้อย่อย (ไม่ติ๊ก = ทั้งหมวด)">
          <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
            {leaves.map((leaf) => (
              <CheckRow
                key={leaf.id}
                state={filter.leaves.includes(leaf.id)}
                onToggle={() => onChange(toggleLeaf(filter, leaf.id))}
              >
                <Icon name={leaf.icon} className="size-4 shrink-0 text-faint" />
                <span className="flex-1">{leaf.label}</span>
              </CheckRow>
            ))}
          </div>
        </Group>
      )}
    </div>
  );
}

/** แถบหมวด — เลือกได้ทีละหมวด เลื่อนซ้ายขวาได้บนมือถือ */
export function CategoryTabs({
  filter,
  onChange,
}: {
  filter: LogFilter;
  onChange: (f: LogFilter) => void;
}) {
  const tabs = [
    { v: "" as const, label: "ทุกหมวด", icon: "list" as const },
    ...LOG_TREE.map((n) => ({ v: n.category, label: n.label, icon: n.icon })),
  ];
  return (
    <div
      role="tablist"
      aria-label="หมวด"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const on = filter.category === t.v;
        return (
          <button
            key={t.v || "all"}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(pickCategory(filter, t.v))}
            className={`press flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              on
                ? "border-accent bg-accent-soft font-semibold text-accent"
                : "border-line bg-surface text-muted hover:text-text"
            }`}
          >
            <Icon name={t.icon} className="size-4 shrink-0" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
