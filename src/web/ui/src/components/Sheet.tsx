import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * แผ่นรายละเอียดที่เลื่อนขึ้นมาจากขอบล่างบนมือถือ และกลายเป็นกล่องกลางจอบนจอใหญ่
 *
 * ใช้แทน modal แบบเดิมเพราะบนมือถือ นิ้วโป้งอยู่ครึ่งล่างของจอ
 * ปุ่มปิดและปุ่มสั่งงานจึงควรอยู่ใกล้มือ ไม่ใช่มุมบนขวาที่ต้องเอื้อม
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // ล็อกไม่ให้หน้าข้างหลังเลื่อนตามตอนปัดในแผ่น
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center">
      <button
        type="button"
        aria-label="ปิด"
        onClick={onClose}
        className="fade-in absolute inset-0 bg-[var(--c-backdrop)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="glass-strong sheet-in relative flex max-h-[88vh] w-full flex-col rounded-t-lg border-b-0 md:max-w-lg md:rounded-lg md:border-b"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          {/* ขีดจับด้านบน — สัญญาณว่าปัดลงเพื่อปิดได้ (ตามแบบแผ่นของระบบ) */}
          <div className="absolute inset-x-0 -top-3 mx-auto h-1 w-10 rounded-full bg-line md:hidden" />
          <div className="min-w-0 flex-1 truncate font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="press rounded-md border border-line bg-surface p-2 text-muted"
          >
            <Icon name="x" className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-safe">
          {children}
        </div>
      </div>
    </div>
  );
}
