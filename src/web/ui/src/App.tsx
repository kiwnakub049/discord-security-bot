import { useCallback, useEffect, useState } from "react";
import { useRoute, type Route } from "./hooks/useRoute";
import { useStream } from "./hooks/useStream";
import { useFetch } from "./hooks/useFetch";
import type { LogEntry } from "./lib/types";
import { EMPTY_FILTER, parseFilter, type LogFilter } from "./lib/logTree";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { StreamNotifier } from "./components/StreamNotifier";
import { Overview } from "./pages/Overview";
import { Logs } from "./pages/Logs";
import { Members } from "./pages/Members";
import { Settings } from "./pages/Settings";
import { BeamNG } from "./pages/BeamNG";
import { Assistant } from "./pages/Assistant";

/** v3 = หมวดแยกเป็นแถบ + ตัวกรองแบบติ๊ก (v2 ติ๊กหมวดได้หลายหมวด ใช้ต่อไม่ได้) */
const FILTER_KEY = "logs.filter.v3";

export function App() {
  const [route, go] = useRoute();
  /**
   * เก็บ log ล่าสุดที่ไหลเข้ามาไว้ที่นี่แล้วส่งลงไปให้หน้า Logs
   *
   * เปิด EventSource ที่ระดับบนสุดที่เดียว ไม่ใช่ในหน้า Logs — ไม่งั้นทุกครั้ง
   * ที่สลับแท็บ สายจะถูกตัดแล้วต่อใหม่ และไฟสถานะบนหัวเว็บก็จะกระพริบตาม
   */
  const [latest, setLatest] = useState<LogEntry | null>(null);
  const stream = useStream(useCallback((entry: LogEntry) => setLatest(entry), []));
  const me = useFetch<{
    username: string;
    role: "admin" | "mod";
    guildId: string | null;
    isOwner: boolean;
    userId: string;
  }>("/api/me");
  const username = me.data?.username ?? "";
  const userId = me.data?.userId ?? "";
  const isAdmin = me.data?.role === "admin";
  const isOwner = me.data?.isOwner === true;
  const guildId = me.data?.guildId ?? null;

  /**
   * ตัวกรองของหน้า Logs อยู่ที่นี่ ไม่ใช่ในหน้า Logs — สลับไปหน้าอื่นแล้วกลับมาจะได้ไม่หาย
   * และจำไว้ในเบราว์เซอร์ด้วย ปิดเว็บเปิดใหม่ก็ยังติ๊กไว้เหมือนเดิม
   */
  const [logFilter, setLogFilter] = useState<LogFilter>(() => {
    try {
      return parseFilter(JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null"));
    } catch {
      return EMPTY_FILTER;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(logFilter));
    } catch {
      /* โหมดส่วนตัว/ปิด storage — แค่ไม่จำ */
    }
  }, [logFilter]);

  return (
    <ToastProvider>
      {/* แจ้งเตือนเรียลไทม์ทุกหน้า — อ่าน log ใหม่จากสตรีมเดียวกับที่ App เปิดไว้ */}
      <StreamNotifier latest={latest} />
      <Shell
        route={route}
        go={go as (r: Route) => void}
        stream={stream}
        username={username}
        userId={userId}
        isOwner={isOwner}
        isAdmin={isAdmin}
      >
        {route === "/" && <Overview go={go} />}
        {route === "/logs" && (
          <Logs
            latest={latest}
            filter={logFilter}
            onFilterChange={setLogFilter}
            guildId={guildId}
          />
        )}
        {route === "/members" && <Members />}
        {route === "/assistant" && isAdmin && <Assistant />}
        {/* กันคนพิมพ์ /beamng เองตอนไม่ใช่เจ้าของ — API ก็ตอบ 404 อยู่แล้วอีกชั้น */}
        {route === "/beamng" && isOwner && <BeamNG />}
        {route === "/settings" && (
          <Settings username={username} userId={userId} isAdmin={isAdmin} />
        )}
      </Shell>
    </ToastProvider>
  );
}
