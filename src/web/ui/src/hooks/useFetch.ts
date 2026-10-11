import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export interface Fetched<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** ดึงใหม่ทันที (ใช้หลังกดปุ่มที่เปลี่ยนข้อมูล) */
  reload: () => void;
}

/**
 * ดึงข้อมูลจาก API หนึ่งเส้น พร้อมดึงซ้ำเป็นระยะ (ถ้ากำหนด intervalMs)
 *
 * สองเรื่องที่ตั้งใจทำ:
 *  - หยุดดึงเมื่อผู้ใช้สลับแท็บ/ปิดจอ (visibilitychange) — บนมือถือคือเรื่องแบตล้วน ๆ
 *    ไม่มีประโยชน์ที่จะ poll ทุก 5 วิ ตอนหน้าเว็บอยู่หลังแอปอื่น
 *  - ระหว่างดึงซ้ำ ยังโชว์ข้อมูลเดิมไว้ ไม่กระพริบเป็นหน้าโหลดทุกครั้ง
 *
 * path = null → ไม่ดึงเลย (เช่นคนนั้นไม่มีสิทธิ์ดูข้อมูลชุดนี้ ไม่ต้องยิงไปโดน 403 ทุก 10 วิ)
 */
export function useFetch<T>(path: string | null, intervalMs?: number): Fetched<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // นับรอบเพื่อทิ้งผลของคำขอเก่าที่กลับมาช้ากว่าคำขอใหม่ (race)
  const seq = useRef(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    try {
      const result = await api.get<T>(path);
      if (!alive.current || mine !== seq.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();

    if (!intervalMs) {
      return () => {
        alive.current = false;
      };
    }

    let timer: number | undefined;
    const start = () => {
      stop();
      timer = window.setInterval(() => void load(), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void load(); // กลับมาดูอีกครั้ง = อยากเห็นของสด ไม่ใช่ของค้างจากตอนสลับออกไป
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, intervalMs, path]);

  return { data, error, loading, reload: () => void load() };
}
