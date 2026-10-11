import { useState } from "react";
import { useFetch } from "../hooks/useFetch";
import type { History, Stats, SystemInfo } from "../lib/types";
import { fmtAgo, fmtClock, fmtDay, fmtNum } from "../lib/format";
import { Card, Chip, Empty, SectionTitle, Spinner, StatStrip } from "../components/ui";
import { PriorityQueue } from "../components/PriorityQueue";
import { MuteList } from "../components/MuteList";
import { Icon } from "../components/Icon";
import { HistoryChart } from "../components/HistoryChart";
import { SystemCard } from "../components/SystemCard";
import type { Route } from "../hooks/useRoute";

export function Overview({ go }: { go: (r: Route) => void }) {
  const [days, setDays] = useState(7);
  const stats = useFetch<Stats>("/api/stats", 15_000);
  const sys = useFetch<SystemInfo>("/api/system", 10_000);
  const history = useFetch<History>(`/api/logs/history?days=${days}`, 60_000);

  if (stats.loading && !stats.data) {
    return (
      <div className="flex justify-center py-16 text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (stats.error && !stats.data) {
    return <Empty icon="warn">{stats.error}</Empty>;
  }

  const s = stats.data;

  return (
    <div className="space-y-8">
      {/*
        ---- เตือนว่ากำลังรันแบบการป้องกันไม่ครบ ----
        บรรทัดเดียวเหนือคิว — สภาพที่แย่ที่สุดคือ anti-spam/AI ปิดอยู่แล้วไม่มีใครรู้
        แต่มันไม่ใช่ "งานที่ต้องกด" เลยไม่ควรกินพื้นที่เท่าการ์ดคิว
      */}
      {sys.data?.degraded && (
        <div role="status" className="rule-l rule-warn flex items-start gap-2.5 rounded-md border border-line bg-surface px-4 py-2.5 text-sm">
          <Icon name="warn" className="mt-0.5 size-4 shrink-0 text-warn" />
          <p className="min-w-0">
            <span className="font-semibold">การป้องกันไม่ครบ</span>
            <span className="text-muted">
              {" "}— Discord ยังไม่อนุมัติสิทธิ์อ่านข้อความและรายชื่อสมาชิก ที่ปิดอยู่: {sys.data.degraded.join(" / ")}
            </span>
          </p>
        </div>
      )}

      {/* ---- งานที่รอคนตัดสิน — สิ่งแรกที่ต้องเห็น ---- */}
      <PriorityQueue />

      {/* ---- ไมค์แดงจากระบบเตือน — ใต้คิวเลย เพราะปุ่มปลดมักต้องกดด่วน (โชว์เฉพาะตอนมีคนโดนอยู่) ---- */}
      <MuteList />

      {/* ---- ตัวเลขประกอบของวันนี้ ---- */}
      {s && (
        <section>
          <SectionTitle>วันนี้</SectionTitle>
          <StatStrip
            items={[
              { label: "เหตุการณ์", value: fmtNum(s.logs.today), sub: `ทั้งหมด ${fmtNum(s.logs.total)}` },
              {
                label: "แจ้งเตือน",
                value: fmtNum(s.logs.todayByLevel.alert),
                sub: s.logs.todayByLevel.warn > 0 ? `เตือนอีก ${fmtNum(s.logs.todayByLevel.warn)}` : "ไม่มีเตือน",
                tone: s.logs.todayByLevel.alert > 0 ? "alert" : "plain",
              },
              {
                label: "อยู่ในห้องเสียง",
                value: fmtNum(s.voice.count),
                sub: s.voice.count ? s.voice.users[0]?.channel : "ห้องว่าง",
              },
              { label: "สมาชิกมีบัตร", value: fmtNum(s.members), sub: `เตือนสะสม ${fmtNum(s.warnings)} ครั้ง` },
            ]}
          />
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-5">
        {/* ---- กราฟย้อนหลัง ---- */}
        <section className="lg:col-span-3">
          <SectionTitle
            action={
              <div className="flex gap-1.5" role="group" aria-label="ช่วงเวลาของกราฟ">
                {[
                  { d: 1, label: "24 ชม." },
                  { d: 7, label: "7 วัน" },
                  { d: 30, label: "30 วัน" },
                ].map((o) => (
                  <Chip key={o.d} active={days === o.d} onClick={() => setDays(o.d)}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            }
          >
            ความเคลื่อนไหว
          </SectionTitle>
          <Card level="glass" className="p-4">
            {history.data ? (
              <HistoryChart history={history.data} />
            ) : (
              <div className="flex h-40 items-center justify-center text-muted">
                <Spinner />
              </div>
            )}
          </Card>
        </section>

        {/* ---- แจ้งเตือนล่าสุด: รายการแบบสมุดเวร เวลาอยู่คอลัมน์ซ้าย ---- */}
        <section className="lg:col-span-2">
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => go("/logs")}
                className="press rounded-md px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft"
              >
                เปิด Logs
              </button>
            }
          >
            แจ้งเตือนล่าสุด
          </SectionTitle>
          {s && s.alerts.length > 0 ? (
            <ol className="rule-l rule-alert divide-y divide-line rounded-md border border-line bg-surface">
              {s.alerts.map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  <time
                    dateTime={new Date(a.timestamp).toISOString()}
                    className="tnum w-14 shrink-0 text-sm text-faint"
                    title={fmtAgo(a.timestamp)}
                  >
                    {isToday(a.timestamp) ? fmtClock(a.timestamp) : fmtDay(a.timestamp)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium leading-snug">{a.title}</p>
                    {a.description && (
                      <p className="truncate text-sm text-muted">{a.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-3 text-sm text-muted">
              <Icon name="shield-check" className="size-5 text-accent" />
              ยังไม่มีแจ้งเตือน
            </div>
          )}
        </section>
      </div>

      {/* ---- ใครอยู่ในห้องเสียง ---- */}
      {s && s.voice.count > 0 && (
        <section>
          <SectionTitle>ในห้องเสียงตอนนี้</SectionTitle>
          <Card className="divide-y divide-line">
            {s.voice.users.map((v) => (
              <div key={v.userId} className="flex items-center gap-3 px-4 py-3">
                <Icon name="user" className="size-5 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{v.username}</div>
                  <div className="truncate text-xs text-muted">{v.channel}</div>
                </div>
                <div className="flex gap-1.5 text-faint">
                  {v.muted && <Icon name="mic-off" className="size-4" />}
                  {v.deaf && <Icon name="headphone-off" className="size-4" />}
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* ---- สถานะเครื่อง ---- */}
      <section>
        <SectionTitle>สถานะเครื่อง</SectionTitle>
        {sys.data ? (
          <SystemCard sys={sys.data} />
        ) : (
          <Card className="flex justify-center p-6 text-muted">
            <Spinner />
          </Card>
        )}
      </section>
    </div>
  );
}

function isToday(ms: number): boolean {
  return new Date(ms).toDateString() === new Date().toDateString();
}
