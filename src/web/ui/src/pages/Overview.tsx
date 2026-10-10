import { useState } from "react";
import { useFetch } from "../hooks/useFetch";
import type { History, Stats, SystemInfo } from "../lib/types";
import { fmtAgo, fmtNum } from "../lib/format";
import { Card, Chip, Empty, SectionTitle, Spinner, StatTile } from "../components/ui";
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
    <div className="space-y-6">
      {/*
        ---- เตือนว่ากำลังรันแบบการป้องกันไม่ครบ ----
        วางไว้บนสุดของหน้าแรกโดยตั้งใจ — สภาพที่แย่ที่สุดคือ anti-spam/AI ปิดอยู่
        แล้วไม่มีใครรู้ เพราะหน้าเว็บดูปกติทุกอย่าง
      */}
      {sys.data?.degraded && (
        <Card level="glass" className="rise !border-warn/50 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-lg bg-warn-soft p-1.5 text-warn">
              <Icon name="warn" className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-warn">
                บอทรันแบบการป้องกันไม่ครบ
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Discord ยังไม่อนุมัติสิทธิ์อ่านข้อความและรายชื่อสมาชิก — ที่ปิดอยู่:
              </p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                {sys.data.degraded.map((f) => (
                  <li key={f} className="flex gap-1.5">
                    <span className="text-warn">•</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* ---- ตัวเลขหลัก ---- */}
      {s && (
        <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label="เหตุการณ์วันนี้"
            value={fmtNum(s.logs.today)}
            sub={`ทั้งหมด ${fmtNum(s.logs.total)}`}
            icon="list"
          />
          <StatTile
            label="แจ้งเตือนวันนี้"
            value={fmtNum(s.logs.todayByLevel.alert)}
            sub={s.logs.todayByLevel.warn > 0 ? `เตือนอีก ${s.logs.todayByLevel.warn}` : "ไม่มีอะไรค้าง"}
            icon="alert"
            tone={s.logs.todayByLevel.alert > 0 ? "alert" : "ok"}
          />
          <StatTile
            label="อยู่ในห้องเสียง"
            value={fmtNum(s.voice.count)}
            sub={s.voice.count ? s.voice.users[0]?.channel : "ห้องว่าง"}
            icon="volume"
            tone={s.voice.count ? "info" : "plain"}
          />
          <StatTile
            label="สมาชิกมีบัตร"
            value={fmtNum(s.members)}
            sub={`เตือนสะสม ${fmtNum(s.warnings)} ครั้ง`}
            icon="users"
          />
        </div>
      )}

      {/* ---- กราฟย้อนหลัง ---- */}
      <section>
        <SectionTitle
          action={
            <div className="flex gap-1.5">
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
        <Card level="glass" className="rise p-4">
          {history.data ? (
            <HistoryChart history={history.data} />
          ) : (
            <div className="flex h-40 items-center justify-center text-muted">
              <Spinner />
            </div>
          )}
        </Card>
      </section>

      {/* ---- แจ้งเตือนล่าสุด ---- */}
      <section>
        <SectionTitle
          action={
            <button
              type="button"
              onClick={() => go("/logs")}
              className="flex items-center gap-0.5 text-xs font-medium text-accent"
            >
              ดูทั้งหมด
              <Icon name="chevron" className="size-3.5" />
            </button>
          }
        >
          แจ้งเตือนล่าสุด
        </SectionTitle>
        {s && s.alerts.length > 0 ? (
          <div className="stagger space-y-2">
            {s.alerts.map((a) => (
              <Card key={a.id} className="flex items-start gap-3 p-3.5">
                <span className="mt-0.5 shrink-0 rounded-lg bg-alert-soft p-1.5 text-alert">
                  <Icon name="alert" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.title}</div>
                  {a.description && (
                    <div className="truncate text-xs text-muted">{a.description}</div>
                  )}
                  <div className="mt-0.5 text-[11px] text-faint">
                    {fmtAgo(a.timestamp)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-ok">
              <Icon name="shield-check" className="size-5" />
              ไม่มีแจ้งเตือนค้างอยู่
            </div>
          </Card>
        )}
      </section>

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
