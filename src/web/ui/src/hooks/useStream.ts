import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../lib/types";

export type StreamState = "connecting" | "live" | "offline";

/**
 * ต่อ /api/stream แล้วส่ง log ใหม่ให้ผู้เรียกผ่าน callback
 *
 * EventSource ต่อใหม่ให้เองอยู่แล้วเวลาสายหลุด แต่มันไม่บอกสถานะที่แสดงผลได้
 * hook นี้เลยแปลง onopen/onerror เป็นสถานะ 3 ค่าให้จุดไฟบนหัวเว็บ
 *
 * onEntry ถูกเก็บใน ref เพื่อไม่ให้การ re-render ของหน้า (ซึ่งสร้าง callback ใหม่ทุกครั้ง)
 * ไปสั่งปิด-เปิด EventSource ใหม่ทั้ง ๆ ที่ยังต่ออยู่ดี ๆ
 */
export function useStream(onEntry: (entry: LogEntry) => void): StreamState {
  const [state, setState] = useState<StreamState>("connecting");
  const handler = useRef(onEntry);
  handler.current = onEntry;

  useEffect(() => {
    const es = new EventSource("/api/stream");

    es.onopen = () => setState("live");
    es.onerror = () => setState("offline");
    es.onmessage = (ev) => {
      try {
        handler.current(JSON.parse(ev.data) as LogEntry);
        // ข้อความมาถึง = สายยังดีอยู่ ต่อให้ onopen ก่อนหน้านี้เคยพลาดไป
        setState("live");
      } catch {
        /* ข้อความเพี้ยน — ข้ามไป ไม่ทำให้ทั้งหน้าพัง */
      }
    };

    return () => es.close();
  }, []);

  return state;
}
