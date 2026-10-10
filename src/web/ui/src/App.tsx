import { useCallback, useState } from "react";
import { useRoute, type Route } from "./hooks/useRoute";
import { useStream } from "./hooks/useStream";
import { useFetch } from "./hooks/useFetch";
import type { LogEntry } from "./lib/types";
import { EMPTY_FILTER, type LogFilter } from "./lib/logTree";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { StreamNotifier } from "./components/StreamNotifier";
import { Overview } from "./pages/Overview";
import { Logs } from "./pages/Logs";
import { Members } from "./pages/Members";
import { Settings } from "./pages/Settings";
import { BeamNG } from "./pages/BeamNG";

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
  }>("/api/me");
  const username = me.data?.username ?? "";
  const isAdmin = me.data?.role === "admin";
  const isOwner = me.data?.isOwner === true;
  const guildId = me.data?.guildId ?? null;

  /**
   * ตัวกรองของหน้า Logs อยู่ที่นี่ ไม่ใช่ในหน้า Logs
   * เพราะต้นไม้หมวดหมู่บนจอใหญ่อยู่ในเมนูซ้าย (ส่วนของ Shell) ส่วนรายการอยู่ในหน้า
   * ทั้งสองที่ต้องอ่าน-เขียนค่าเดียวกัน
   */
  const [logFilter, setLogFilter] = useState<LogFilter>(EMPTY_FILTER);

  // กดกิ่งจากเมนูซ้ายตอนอยู่หน้าอื่น = พาไปหน้า Logs ให้เลย
  const pickLogFilter = useCallback(
    (f: LogFilter) => {
      setLogFilter(f);
      if (window.location.pathname !== "/logs") go("/logs");
    },
    [go],
  );

  return (
    <ToastProvider>
      {/* แจ้งเตือนเรียลไทม์ทุกหน้า — อ่าน log ใหม่จากสตรีมเดียวกับที่ App เปิดไว้ */}
      <StreamNotifier latest={latest} />
      <Shell
        route={route}
        go={go as (r: Route) => void}
        stream={stream}
        username={username}
        isOwner={isOwner}
        logFilter={logFilter}
        onPickLogFilter={pickLogFilter}
      >
        {route === "/" && <Overview go={go} />}
        {route === "/logs" && (
          <Logs
            latest={latest}
            filter={logFilter}
            onPickFilter={setLogFilter}
            guildId={guildId}
          />
        )}
        {route === "/members" && <Members />}
        {/* กันคนพิมพ์ /beamng เองตอนไม่ใช่เจ้าของ — API ก็ตอบ 404 อยู่แล้วอีกชั้น */}
        {route === "/beamng" && isOwner && <BeamNG />}
        {route === "/settings" && (
          <Settings username={username} isAdmin={isAdmin} />
        )}
      </Shell>
    </ToastProvider>
  );
}
