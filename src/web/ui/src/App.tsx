import { useCallback, useEffect, useState } from "react";
import { ROUTES, useRoute, type Route } from "./hooks/useRoute";
import { registerSW } from "./lib/push";
import { useStream } from "./hooks/useStream";
import { useFetch } from "./hooks/useFetch";
import type { LogEntry } from "./lib/types";
import { EMPTY_FILTER, parseFilter, type LogFilter, type TreePick } from "./lib/logTree";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { StreamNotifier } from "./components/StreamNotifier";
import { Overview } from "./pages/Overview";
import { Logs } from "./pages/Logs";
import { Members } from "./pages/Members";
import { Settings } from "./pages/Settings";
import { BeamNG } from "./pages/BeamNG";
import { Assistant } from "./pages/Assistant";
import { Team } from "./pages/Team";

/** ตัวกรองหน้า Logs ที่จำไว้ในเบราว์เซอร์ — v4 = ต้นไม้หมวด + ติ๊กระดับ */
const FILTER_KEY = "logs.filter.v4";

export function App() {
  const [route, go] = useRoute();

  // service worker: รับแจ้งเตือนมือถือ + กดแจ้งเตือนแล้วพามาหน้าที่เกี่ยว (sw.js ส่ง "navigate" มา)
  useEffect(() => {
    void registerSW();
    const onMsg = (e: MessageEvent) => {
      const url = (e.data as { type?: string; url?: string } | null)?.url;
      if ((e.data as { type?: string })?.type === "navigate" && (ROUTES as readonly string[]).includes(url ?? "")) {
        go(url as Route);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [go]);
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
    seesSystem: boolean;
    userId: string;
  }>("/api/me");
  const username = me.data?.username ?? "";
  const userId = me.data?.userId ?? "";
  const isOwner = me.data?.isOwner === true;
  // admin ที่ไม่ใช่เจ้าของไม่เห็นตั้งค่าระบบ/สถานะ Pi — ค่าเริ่ม false จนกว่า /api/me จะตอบ
  const seesSystem = me.data?.seesSystem === true;
  const guildId = me.data?.guildId ?? null;
  // admin ทั่วไปเปิด /settings หรือ /assistant ตรง ๆ (บุ๊กมาร์กเก่า) → พากลับหน้าแรก
  useEffect(() => {
    if (me.data && !seesSystem && (route === "/settings" || route === "/assistant")) go("/");
  }, [me.data, seesSystem, route, go]);

  // จุดแจ้งเตือนของแชททีมบนเมนู — ดึงทุก 15 วิ (useFetch หยุดเองตอนสลับแท็บ)
  const teamUnread = useFetch<{ unread: number; mentioned: boolean }>("/api/team/unread", 15_000);

  /**
   * ตัวกรองของหน้า Logs อยู่ที่นี่ ไม่ใช่ในหน้า Logs
   * เพราะต้นไม้หมวดหมู่บนจอใหญ่อยู่ในเมนูซ้าย (ส่วนของ Shell) ส่วนรายการอยู่ในหน้า
   * ทั้งสองที่ต้องอ่าน-เขียนค่าเดียวกัน · จำไว้ในเบราว์เซอร์ด้วย ปิดเว็บเปิดใหม่ก็ยังอยู่
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

  // กดกิ่งจากเมนูซ้ายตอนอยู่หน้าอื่น = พาไปหน้า Logs ให้เลย (ระดับ/เวลาที่ติ๊กไว้คงเดิม)
  const pickLogFilter = useCallback(
    (p: TreePick) => {
      setLogFilter((prev) => ({ ...prev, ...p }));
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
        userId={userId}
        isOwner={isOwner}
        logFilter={logFilter}
        onPickLogFilter={pickLogFilter}
        teamBadge={teamUnread.data}
        seesSystem={seesSystem}
      >
        {route === "/" && <Overview go={go} seesSystem={seesSystem} />}
        {route === "/logs" && (
          <Logs
            latest={latest}
            filter={logFilter}
            onFilterChange={setLogFilter}
            onPickTree={pickLogFilter}
            guildId={guildId}
          />
        )}
        {route === "/members" && <Members />}
        {route === "/team" && <Team userId={userId} />}
        {route === "/assistant" && seesSystem && <Assistant />}
        {/* กันคนพิมพ์ /beamng เองตอนไม่ใช่เจ้าของ — API ก็ตอบ 404 อยู่แล้วอีกชั้น */}
        {route === "/beamng" && isOwner && <BeamNG />}
        {route === "/settings" && seesSystem && (
          <Settings
            username={username}
            userId={userId}
            seesSystem={seesSystem}
          />
        )}
      </Shell>
    </ToastProvider>
  );
}
