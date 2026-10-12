import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lang, setLang, t } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";
import type { StreamState } from "../hooks/useStream";
import { type Route } from "../hooks/useRoute";
import { useTheme } from "../hooks/useTheme";
import { LogTree } from "./LogTree";
import type { TreePick } from "../lib/logTree";
import { useNotifyEnabled } from "../lib/notify";
import { NotifySheet } from "./NotifySheet";
import { Avatar } from "./Avatar";

const TABS: { route: Route; label: string; icon: IconName }[] = [
  { route: "/", label: t("ภาพรวม"), icon: "home" },
  { route: "/logs", label: "Logs", icon: "list" },
  { route: "/members", label: t("สมาชิก"), icon: "users" },
  { route: "/team", label: t("แชททีม"), icon: "message" },
  { route: "/assistant", label: t("ผู้ช่วย AI"), icon: "bot" },
  { route: "/beamng", label: "BeamNG", icon: "car" },
  { route: "/settings", label: t("ตั้งค่า"), icon: "settings" },
];

/** แท็บที่มีให้เฉพาะเจ้าของเครื่อง — คนอื่นไม่เห็นแม้แต่ชื่อ */
const OWNER_ONLY = new Set<Route>(["/beamng"]);
/** admin ทั่วไป (ไม่ใช่เจ้าของ) ไม่เห็น — mod เห็นตั้งค่าปกติ (ด่านจริงคือ requireSystemView) */
const SYSTEM_ONLY = new Set<Route>(["/settings", "/assistant"]);

const TITLES: Record<Route, string> = {
  "/": t("ภาพรวม"),
  "/logs": "Logs",
  "/members": t("สมาชิก"),
  "/team": t("แชททีม"),
  "/assistant": t("ผู้ช่วย AI"),
  "/beamng": t("เซิร์ฟเวอร์ BeamNG"),
  "/settings": t("ตั้งค่า"),
};

function TeamBadge({ badge }: { badge: { unread: number; mentioned: boolean } | null }) {
  if (!badge || badge.unread === 0) return null;
  return (
    <span
      className="tnum rounded-full bg-alert px-1.5 text-[10px] font-semibold leading-4 text-surface"
    >
      {badge.mentioned ? "@" : ""}
      {badge.unread > 99 ? "99+" : badge.unread}
    </span>
  );
}

function LiveDot({ state }: { state: StreamState }) {
  const tone =
    state === "live" ? "bg-ok" : state === "connecting" ? "bg-warn" : "bg-alert";
  const label =
    state === "live" ? t("สด") : state === "connecting" ? t("กำลังต่อ") : t("หลุด");
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted"
      title={t("สถานะสตรีม: {label}", { label })}
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
/** กระดิ่ง = เปิดหน้าตั้งค่าการแจ้งเตือน (มือถือ/ตอนปิดเว็บ + เสียงในหน้าเว็บ) */
function NotifyButton() {
  const enabled = useNotifyEnabled();
  const [open, setOpen] = useState(false);
  return (
    <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={t("ตั้งค่าการแจ้งเตือน")}
      aria-label={t("ตั้งค่าการแจ้งเตือน")}
      aria-haspopup="dialog"
      className={`press rounded-md border border-line bg-surface p-2 ${enabled ? "text-accent" : "text-faint"}`}
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
    {/* portal: หัวเว็บมี backdrop-filter = position:fixed ข้างในจะติดอยู่ในหัว ไม่ลอยทับทั้งจอ */}
    {createPortal(<NotifySheet open={open} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** สลับไทย/อังกฤษ — ป้ายบอกภาษาที่จะเปลี่ยนไป (reload ทั้งหน้า) */
function LangButton() {
  const next = lang === "th" ? "en" : "th";
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={next === "en" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"} // i18n-ignore
      aria-label={next === "en" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"} // i18n-ignore
      className="press min-w-10 rounded-md border border-line bg-surface px-2 py-2 text-xs font-semibold text-muted"
    >
      {next === "en" ? "EN" : "TH"}
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
    theme === "light" ? t("โทนสว่าง") : theme === "dark" ? t("โทนมืด") : t("ตามเครื่อง");

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={t("ธีม: {label} (กดเพื่อเปลี่ยน)", { label })}
      aria-label={t("ธีม: {label}", { label })}
      className="press rounded-md border border-line bg-surface p-2 text-muted"
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
 * .aurora ตอนนี้เป็นแค่พื้นสีกระดาษทึบ (คงไว้เป็นชั้นล่างสุดเผื่ออยากใส่ลายพื้นทีหลัง)
 */
export function Shell({
  route,
  go,
  stream,
  username,
  userId,
  isOwner,
  logFilter,
  onPickLogFilter,
  teamBadge,
  seesSystem,
  children,
}: {
  route: Route;
  go: (r: Route) => void;
  stream: StreamState;
  username: string;
  /** Discord user ID ของคนที่ login — ใช้แสดงรูปโปรไฟล์ */
  userId: string;
  /** เจ้าของเครื่องเท่านั้นที่เห็นแท็บบางอัน (ด่านจริงอยู่ฝั่งเซิร์ฟเวอร์) */
  isOwner: boolean;
  logFilter: TreePick;
  onPickLogFilter: (f: TreePick) => void;
  /** แชททีม: ข้อความที่ยังไม่อ่าน (แดง) + มีคนแท็กเราไหม (มี @ นำหน้า) */
  teamBadge: { unread: number; mentioned: boolean } | null;
  /** false = admin ที่ไม่ใช่เจ้าของ → ไม่เห็นแท็บตั้งค่าและผู้ช่วย AI */
  seesSystem: boolean;
  children: ReactNode;
}) {
  /*
   * จำนวนแท็บไม่คงที่อีกต่อไป — เม็ดยาบนแถบล่างจึงต้องคิดจากแท็บ "ที่เห็นจริง"
   * ไม่ใช่จาก ROUTES ทั้งหมด ไม่งั้นตำแหน่งจะเลื่อนผิดไปหนึ่งช่องสำหรับคนที่ไม่ใช่เจ้าของ
   */
  const tabs = TABS.filter(
    (tab) =>
      (isOwner || !OWNER_ONLY.has(tab.route)) &&
      (seesSystem || !SYSTEM_ONLY.has(tab.route)),
  );
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.route === route),
  );

  return (
    <div className="min-h-dvh md:flex">
      <div className="aurora" aria-hidden="true" />

      {/* ---- เมนูซ้าย (เฉพาะจอใหญ่) — กระดาษแผ่นล่าง ---- */}
      <aside className="side sticky top-0 hidden h-dvh w-60 shrink-0 flex-col px-3 py-4 md:flex">
        <div className="mb-4 flex items-center gap-2.5 px-1.5">
          {/* รูปเซิร์ฟ Discord — ไม่มีรูปเซิร์ฟ server ส่ง icon.svg มาแทน */}
          <img src="/server-icon" alt="" className="size-8 shrink-0 rounded-md object-cover" />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-text leading-tight">Undawn Dashboard</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className="size-2 rounded-full bg-ok" />
              {t("บอทออนไลน์")}
            </div>
          </div>
        </div>

        {/*
          เมนูซ้ายไม่ใช้เม็ดยาเลื่อนแบบแถบล่างแล้ว — พอมีต้นไม้กางอยู่ใต้ Logs
          ความสูงของแต่ละแถวไม่คงที่อีกต่อไป การคำนวณตำแหน่งจาก index จึงเพี้ยน
          (แถบล่างบนมือถือยังใช้ได้เพราะทุกแท็บกว้างเท่ากันเสมอ)
        */}
        <nav className="flex flex-col gap-0.5 overflow-y-auto" aria-label={t("เมนูหลัก")}>
          {tabs.map((tab) => (
            <div key={tab.route}>
              <button
                type="button"
                onClick={() => go(tab.route)}
                aria-current={route === tab.route ? "page" : undefined}
                // เมนูที่เลือก = เส้นฟ้าด้านซ้ายแบบเดียวกับเส้นระดับบนการ์ด ไม่ใช่เม็ดยาสีทึบ
                className={`press flex h-10 w-full items-center gap-3 rounded-md border-l-[3px] px-3 text-[15px] transition-colors ${
                  route === tab.route
                    ? "border-accent bg-surface font-semibold text-text"
                    : "border-transparent text-muted hover:bg-raised hover:text-text"
                }`}
              >
                <Icon name={tab.icon} className="size-5" />
                <span className="flex-1 text-left">{tab.label}</span>
                {tab.route === "/team" && <TeamBadge badge={teamBadge} />}
              </button>

              {/* ต้นไม้หมวดหมู่ กางอยู่ใต้ Logs เมื่ออยู่หน้านั้น */}
              {tab.route === "/logs" && route === "/logs" && (
                <div className="fade-in mt-1 border-l border-line pl-2">
                  <LogTree filter={logFilter} onPick={onPickLogFilter} compact />
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex items-center gap-2 border-t border-line px-2 pt-3 text-sm">
          <Avatar id={userId} name={username} size="sm" />
          <span className="min-w-0 flex-1 truncate text-muted">{username}</span>
          <form method="post" action="/logout">
            <button
              type="submit"
              aria-label={t("ออกจากระบบ")}
              title={t("ออกจากระบบ")}
              className="press rounded-md p-2 text-muted hover:bg-raised hover:text-text"
            >
              <Icon name="logout" className="size-4" />
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- หัวเว็บ ---- */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 pt-safe backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 md:px-8">
            <img src="/server-icon" alt="" className="size-6 rounded-md object-cover md:hidden" />
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
              {TITLES[route]}
            </h1>
            <LiveDot state={stream} />
            <NotifyButton />
            <LangButton />
            <ThemeButton />
            {/* ไม่มีหน้าตั้งค่า = ไม่มีปุ่มออกจากระบบบนมือถือ — ใส่ไว้บนหัวแทน */}
            {!seesSystem && (
              <form method="post" action="/logout" className="md:hidden">
                <button
                  type="submit"
                  aria-label={t("ออกจากระบบ")}
                  title={t("ออกจากระบบ")}
                  className="press rounded-md border border-line bg-surface p-2 text-muted"
                >
                  <Icon name="logout" className="size-5" />
                </button>
              </form>
            )}
          </div>
        </header>

        {/* pb-28 บนมือถือ = เผื่อที่ให้แถบแท็บล่าง ไม่ให้ทับเนื้อหาบรรทัดสุดท้าย */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-7">
          {children}
        </main>

        {/* ---- แถบแท็บล่าง (เฉพาะมือถือ) ---- */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-safe md:hidden" aria-label={t("เมนูหลัก")}>
          <div className="relative flex">
            {/*
              เม็ดยาเลื่อนตามแท็บ — คำนวณจาก index เป็นเปอร์เซ็นต์ของความกว้างตัวเอง
              (แต่ละแท็บกว้างเท่ากันเสมอเพราะ flex-1) เลยไม่ต้องวัดขนาด DOM
            */}
            <span
              aria-hidden="true"
              className="absolute bottom-1 top-1 rounded-md bg-accent-soft transition-transform duration-[350ms] [transition-timing-function:var(--ease-spring)]"
              style={{
                width: `${100 / tabs.length}%`,
                transform: `translateX(${activeIndex * 100}%)`,
              }}
            />
            {tabs.map((tab) => {
              const r = tab.route;
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
                  <span className="relative">
                    <Icon name={tab.icon} className="size-[22px]" />
                    {r === "/team" && (
                      <span className="absolute -right-2.5 -top-1.5">
                        <TeamBadge badge={teamBadge} />
                      </span>
                    )}
                  </span>
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
