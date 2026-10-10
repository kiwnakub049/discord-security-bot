import { useEffect, useRef } from "react";
import type { LogEntry } from "../lib/types";
import { useToast } from "./Toast";
import { notifyDesktop, playBeep, useNotifyEnabled } from "../lib/notify";

/**
 * ส่งการแจ้งเตือนเรียลไทม์จากสตรีม log — ทำงานทุกหน้า (ไม่ต้องอยู่หน้า Logs)
 *
 * วางไว้ใน ToastProvider ที่ระดับ App: log ใหม่ทุกอันไหลผ่าน prop `latest` อยู่แล้ว
 *   - level "alert" → toast แดง + เสียง + แจ้งเตือนเดสก์ท็อป (ถ้าเปิดกระดิ่ง + ได้สิทธิ์)
 *   - level "warn"  → toast เท่านั้น
 *   - level "info"  → เงียบ (ไหลลงฟีดหน้า Logs ตามปกติ ไม่รบกวน)
 *
 * ตัวมันเองไม่วาดอะไร (คืน null) — toast โผล่จาก ToastProvider
 */
export function StreamNotifier({ latest }: { latest: LogEntry | null }) {
  const toast = useToast();
  const enabled = useNotifyEnabled();
  const seen = useRef<number | null>(null);

  // เก็บ enabled ไว้ใน ref ให้ effect อ่านค่าล่าสุดโดยไม่ต้อง re-run ตอนสลับกระดิ่ง
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!latest) return;
    // ครั้งแรกหลังโหลด: จำ id ล่าสุดไว้เฉย ๆ ไม่เด้ง (กันแจ้งเตือนของเก่าตอนเพิ่งเปิดหน้า)
    if (seen.current === null) {
      seen.current = latest.id;
      return;
    }
    if (latest.id === seen.current) return;
    seen.current = latest.id;

    if (latest.level === "info") return; // ไม่รบกวนเรื่องทั่วไป

    // ข้อความย่อ: หัวข้อ + ชื่อผู้เกี่ยวข้อง (ถ้ามีช่อง User)
    const who = latest.fields.find((f) => f.name === "User")?.value;
    const short = who ? `${latest.title} · ${who.split(" (")[0]}` : latest.title;

    toast(short, latest.level === "alert" ? "error" : "info");

    if (latest.level === "alert" && enabledRef.current) {
      playBeep();
      notifyDesktop(latest.title, who ?? latest.category);
    }
  }, [latest, toast]);

  return null;
}
