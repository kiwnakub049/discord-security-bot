import type { ReactNode } from "react";
import { Icon } from "./Icon";
import {
  LOG_TREE,
  categoryState,
  leafChecked,
  toggleCategory,
  toggleLeaf,
  toggleLevel,
  type LogFilter,
} from "../lib/logTree";
import type { LogLevel } from "../lib/types";

/**
 * แผงตัวกรองของหน้า Logs — ติ๊กได้หลายช่องพร้อมกัน
 *
 * ของเดิมเป็นต้นไม้ที่กดได้ทีละกิ่ง อยากดู "เตือนสมาชิก + ไมค์แดง" พร้อมกันทำไม่ได้
 * และกิ่งย่อยต้องกางก่อนถึงจะเห็น ตอนนี้ทุกกิ่งโชว์หมด ติ๊กกี่อันก็ได้
 * ไม่ติ๊กอะไรเลยในกลุ่มไหน = ไม่กรองด้วยกลุ่มนั้น
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

      <Group title="หมวด">
        <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {LOG_TREE.map((node) => {
            const st = categoryState(filter, node.category);
            return (
              <div key={node.category}>
                <CheckRow
                  state={st === "all" ? true : st === "some" ? "mixed" : false}
                  onToggle={() => onChange(toggleCategory(filter, node.category))}
                  className="font-medium"
                >
                  <Icon name={node.icon} className="size-4 shrink-0 text-accent" />
                  <span className="flex-1">{node.label}</span>
                </CheckRow>
                {node.leaves.length > 0 && (
                  <div className="relative ml-[17px] border-l border-line pl-2">
                    {node.leaves.map((leaf) => (
                      <CheckRow
                        key={leaf.id}
                        state={leafChecked(filter, node.category, leaf.id)}
                        onToggle={() => onChange(toggleLeaf(filter, node.category, leaf.id))}
                        className="text-muted"
                      >
                        <Icon name={leaf.icon} className="size-3.5 shrink-0 text-faint" />
                        <span className="flex-1">{leaf.label}</span>
                      </CheckRow>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Group>
    </div>
  );
}
