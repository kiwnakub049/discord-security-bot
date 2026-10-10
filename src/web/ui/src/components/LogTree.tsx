import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { LOG_TREE, type LogFilter } from "../lib/logTree";

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
  filter: LogFilter;
  onPick: (f: LogFilter) => void;
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
        ทั้งหมด
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
