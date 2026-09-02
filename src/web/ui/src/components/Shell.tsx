import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import type { StreamState } from "../hooks/useStream";
import { ROUTES, type Route } from "../hooks/useRoute";
import { useTheme } from "../hooks/useTheme";
import { LogTree } from "./LogTree";
import type { LogFilter } from "../lib/logTree";
import {
  requestNotifyPermission,
  setNotifyEnabled,
  useNotifyEnabled,
} from "../lib/notify";

const TABS: { route: Route; label: string; icon: IconName }[] = [
  { route: "/", label: "ภาพรวม", icon: "home" },
  { route: "/logs", label: "Logs", icon: "list" },
  { route: "/members", label: "สมาชิก", icon: "users" },
  { route: "/settings", label: "ตั้งค่า", icon: "settings" },
];

const TITLES: Record<Route, string> = {
  "/": "ภาพรวม",
  "/logs": "Logs",
  "/members": "สมาชิก",
  "/settings": "ตั้งค่า",
};

function LiveDot({ state }: { state: StreamState }) {
  const tone =
    state === "live" ? "bg-ok" : state === "connecting" ? "bg-warn" : "bg-alert";
  const label =
    state === "live" ? "สด" : state === "connecting" ? "กำลังต่อ" : "หลุด";
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted"
      title={`สถานะสตรีม: ${label}`}
    >
      <span className="relative flex size-2">
        {state === "live" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
        )}
        <span className={`relative inline-flex size-2 rounded-full ${tone}`} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/** ปุ่มกระดิ่ง — เปิด/ปิดเสียง + แจ้งเตือนเดสก์ท็อป (toast ในแอปยังเด้งเสมอ) */
function NotifyButton() {
  const enabled = useNotifyEnabled();
  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled;
        setNotifyEnabled(next);
        // ขอสิทธิ์เดสก์ท็อปตอนเปิด (นี่คือ user gesture ที่เบราว์เซอร์ต้องการ)
        if (next) requestNotifyPermission();
      }}
      title={enabled ? "แจ้งเตือน: เปิด (กดเพื่อปิดเสียง/เดสก์ท็อป)" : "แจ้งเตือน: ปิด"}
      aria-label={enabled ? "ปิดแจ้งเตือน" : "เปิดแจ้งเตือน"}
      aria-pressed={enabled}
      className={`press rounded-xl border border-line bg-surface p-2 ${enabled ? "text-accent" : "text-faint"}`}
    >
      {enabled ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8.7 3.7A6 6 0 0118 8c0 3 1 5 2 6" />
          <path d="M6 8c0 7-3 9-3 9h13" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
          <path d="M3 3l18 18" />
        </svg>
      )}
    </button>
  );
}

function ThemeButton() {
  const [theme, setTheme] = useTheme();
  // วนสามค่า: ตามระบบ → สว่าง → มืด แล้ววนกลับ
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const icon: IconName =
    theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor";
  const label =
    theme === "light" ? "โทนสว่าง" : theme === "dark" ? "โทนมืด" : "ตามเครื่อง";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`ธีม: ${label} (กดเพื่อเปลี่ยน)`}
      aria-label={`ธีม: ${label}`}
      className="press rounded-xl border border-line bg-surface p-2 text-muted"
    >
      <Icon name={icon} className="size-5" />
    </button>
  );
}

/**
 * โครงหน้าจอ
 *
 * มือถือ: หัวเว็บติดบน + แถบแท็บติดล่าง (นิ้วโป้งถึง) เนื้อหาอยู่ตรงกลาง
 * จอใหญ่ (md ขึ้นไป): แถบล่างหายไป กลายเป็นเมนูด้านซ้ายค้างไว้แทน
 *
 * ชั้นล่างสุดคือ .aurora — พื้นไล่สีที่ขยับช้า ๆ ซึ่งเป็นตัวที่ทำให้กระจกทุกชิ้น
 * ข้างบนมีอะไรให้เห็นทะลุ ถ้าเอาออกทั้งเว็บจะกลายเป็นการ์ดโปร่งบนพื้นเรียบ ๆ ทันที
 */
export function Shell({
  route,
  go,
  stream,
  username,
  logFilter,
  onPickLogFilter,
  children,
}: {
  route: Route;
  go: (r: Route) => void;
  stream: StreamState;
  username: string;
  logFilter: LogFilter;
  onPickLogFilter: (f: LogFilter) => void;
  children: ReactNode;
}) {
  const activeIndex = Math.max(
    0,
    ROUTES.findIndex((r) => r === route),
  );

  return (
    <div className="min-h-dvh md:flex">
      <div className="aurora" aria-hidden="true" />

      {/* ---- เมนูซ้าย (เฉพาะจอใหญ่) — แถบ aubergine แบบ Slack ---- */}
      <aside className="side sticky top-0 hidden h-dvh w-64 shrink-0 flex-col rounded-none px-2.5 py-3 md:flex">
        <div className="mb-3 flex items-center gap-2.5 border-b border-line px-1.5 pb-3">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "#2eb67d" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0b3d2c" strokeWidth="2.4">
              <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-text leading-tight">Security Bot</div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-2 rounded-full" style={{ background: "#2eb67d" }} />
              ออนไลน์
            </div>
          </div>
        </div>

        {/*
          เมนูซ้ายไม่ใช้เม็ดยาเลื่อนแบบแถบล่างแล้ว — พอมีต้นไม้กางอยู่ใต้ Logs
          ความสูงของแต่ละแถวไม่คงที่อีกต่อไป การคำนวณตำแหน่งจาก index จึงเพี้ยน
          (แถบล่างบนมือถือยังใช้ได้เพราะทุกแท็บกว้างเท่ากันเสมอ)
        */}
        <nav className="flex flex-col gap-1 overflow-y-auto">
          {TABS.map((t) => (
            <div key={t.route}>
              <button
                type="button"
                onClick={() => go(t.route)}
                aria-current={route === t.route ? "page" : undefined}
                className={`press flex h-[42px] w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                  route === t.route
                    ? "border border-accent/30 bg-accent-soft text-accent"
                    : "text-muted hover:text-text"
                }`}
              >
                <Icon name={t.icon} className="size-5" />
                {t.label}
              </button>

              {/* ต้นไม้หมวดหมู่ กางอยู่ใต้ Logs เมื่ออยู่หน้านั้น */}
              {t.route === "/logs" && route === "/logs" && (
                <div className="fade-in mt-1 border-l border-line pl-2">
                  <LogTree filter={logFilter} onPick={onPickLogFilter} compact />
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex items-center gap-2 border-t border-line px-2 pt-3 text-sm">
          <Icon name="user" className="size-5 text-faint" />
          <span className="min-w-0 flex-1 truncate text-muted">{username}</span>
          <form method="post" action="/logout">
            <button
              type="submit"
              aria-label="ออกจากระบบ"
              title="ออกจากระบบ"
              className="press rounded-lg p-2 text-muted hover:text-alert"
            >
              <Icon name="logout" className="size-4" />
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- หัวเว็บ ---- */}
        <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0 pt-safe">
          <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-3 px-4">
            <img src="/icon.svg" alt="" className="size-6 md:hidden" />
            <h1 className="min-w-0 flex-1 truncate text-lg font-bold">
              {TITLES[route]}
            </h1>
            <LiveDot state={stream} />
            <NotifyButton />
            <ThemeButton />
          </div>
        </header>

        {/* pb-28 บนมือถือ = เผื่อที่ให้แถบแท็บล่าง ไม่ให้ทับเนื้อหาบรรทัดสุดท้าย */}
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-28 pt-4 md:pb-10">
          {children}
        </main>

        {/* ---- แถบแท็บล่าง (เฉพาะมือถือ) ---- */}
        <nav className="glass fixed inset-x-0 bottom-0 z-30 rounded-none border-x-0 border-b-0 pb-safe md:hidden">
          <div className="relative flex">
            {/*
              เม็ดยาเลื่อนตามแท็บ — คำนวณจาก index เป็นเปอร์เซ็นต์ของความกว้างตัวเอง
              (แต่ละแท็บกว้างเท่ากันเสมอเพราะ flex-1) เลยไม่ต้องวัดขนาด DOM
            */}
            <span
              aria-hidden="true"
              className="absolute bottom-1 top-1 rounded-2xl bg-accent-soft transition-transform duration-[350ms] [transition-timing-function:var(--ease-spring)]"
              style={{
                width: `${100 / ROUTES.length}%`,
                transform: `translateX(${activeIndex * 100}%)`,
              }}
            />
            {ROUTES.map((r) => {
              const tab = TABS.find((t) => t.route === r);
              if (!tab) return null;
              const active = route === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => go(r)}
                  aria-current={active ? "page" : undefined}
                  // min-h 56px = ขนาดเป้าแตะที่นิ้วโป้งกดพลาดยาก
                  className={`press relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                    active ? "text-accent" : "text-faint"
                  }`}
                >
                  <Icon name={tab.icon} className="size-[22px]" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
