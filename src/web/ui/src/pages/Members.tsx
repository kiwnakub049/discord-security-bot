import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import type { Member, MemberPage, RankEntry } from "../lib/types";
import { fmtDuration, fmtNum } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  Empty,
  Meter,
  SearchBox,
  Spinner,
} from "../components/ui";
import { Icon } from "../components/Icon";
import { MemberSheet, VoiceBadges } from "../components/MemberSheet";

const FILTERS = [
  { v: "", label: "ทั้งหมด" },
  { v: "voice", label: "อยู่ในห้องเสียง" },
  { v: "mute", label: "ปิดไมค์" },
  { v: "deaf", label: "ปิดหูฟัง" },
  { v: "offline", label: "ไม่อยู่ในห้อง" },
] as const;

const PAGE = 24;

export function Members() {
  const [tab, setTab] = useState<"list" | "rank">("list");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Chip active={tab === "list"} onClick={() => setTab("list")}>
          รายชื่อ
        </Chip>
        <Chip active={tab === "rank"} onClick={() => setTab("rank")}>
          อันดับ
        </Chip>
      </div>
      {tab === "list" ? <MemberList /> : <Leaderboard />}
    </div>
  );
}

function MemberList() {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState<MemberPage | null>(null);
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // เปลี่ยนเงื่อนไข = เริ่มนับหน้าใหม่ ไม่ต่อท้ายของเดิม
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<MemberPage>(`/api/members${qs({ filter, q: debounced, limit: PAGE })}`)
      .then((p) => {
        if (!alive) return;
        setPage(p);
        setRows(p.entries);
        setError(null);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filter, debounced, reloadKey]);

  async function more() {
    if (!page) return;
    const next = await api.get<MemberPage>(
      `/api/members${qs({ filter, q: debounced, limit: PAGE, offset: rows.length })}`,
    );
    setRows((prev) => [...prev, ...next.entries]);
    setPage(next);
  }

  const hasMore = page ? rows.length < page.total : false;

  return (
    <>
      <div className="space-y-2.5">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="ค้นหาชื่อ / เลขสมาชิก / ไบแอส…"
        />
        <ChipRow>
          {FILTERS.map((f) => (
            <Chip key={f.v} active={filter === f.v} onClick={() => setFilter(f.v)}>
              {f.label}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16 text-muted">
          <Spinner className="size-6" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <Empty icon="warn">{error}</Empty>
          <Button onClick={() => setReloadKey((k) => k + 1)}>ลองใหม่</Button>
        </div>
      ) : rows.length === 0 ? (
        <Empty icon="users">ไม่พบสมาชิกที่ตรงกับเงื่อนไข</Empty>
      ) : (
        <div className="stagger mt-4 space-y-2">
          {page && (
            <p className="px-1 text-xs text-faint">
              {rows.length < page.total
                ? `แสดง ${rows.length} จาก ${page.total} คน`
                : `${page.total} คน`}
            </p>
          )}
          {rows.map((m) => (
            <Card key={m.id} className="pane-lift">
              <button
                type="button"
                onClick={() => setSelected(m)}
                className="press flex w-full items-center gap-3 p-3.5 text-left"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-xs font-bold text-muted shadow-[inset_0_1px_0_0_var(--glass-spec)]">
                  #{m.member_number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {m.username}
                    </span>
                    {m.warnings > 0 && (
                      <Badge tone="warn">เตือน {m.warnings}</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="tnum">Lv.{m.level}</span>
                    <span className="text-faint">·</span>
                    <span className="tnum">{fmtNum(m.xp)} XP</span>
                  </div>
                  <div className="mt-1.5">
                    <VoiceBadges member={m} />
                  </div>
                </div>
                <Icon name="chevron" className="size-4 shrink-0 text-faint" />
              </button>
            </Card>
          ))}

          {hasMore && (
            <Button full onClick={() => void more()}>
              โหลดเพิ่ม
            </Button>
          )}
        </div>
      )}

      <MemberSheet
        member={selected}
        onClose={() => setSelected(null)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}

function Leaderboard() {
  const [by, setBy] = useState<"xp" | "voice">("xp");
  const { data, loading } = useFetch<{ entries: RankEntry[] }>(
    `/api/leaderboard?by=${by}&limit=20`,
  );

  const medal = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Chip active={by === "xp"} onClick={() => setBy("xp")}>
          <span className="flex items-center gap-1.5">
            <Icon name="trophy" className="size-3.5" />
            ค่าประสบการณ์
          </span>
        </Chip>
        <Chip active={by === "voice"} onClick={() => setBy("voice")}>
          <span className="flex items-center gap-1.5">
            <Icon name="volume" className="size-3.5" />
            เวลาในห้องเสียง
          </span>
        </Chip>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16 text-muted">
          <Spinner className="size-6" />
        </div>
      ) : !data || data.entries.length === 0 ? (
        <Empty icon="trophy">ยังไม่มีข้อมูลพอจะจัดอันดับ</Empty>
      ) : (
        <div className="stagger space-y-2">
          {data.entries.map((e, i) => (
            <Card key={e.userId} className="pane-lift flex items-center gap-3 p-3.5">
              <span
                className={`tnum w-8 shrink-0 text-center font-bold ${
                  i < 3 ? "text-lg" : "text-sm text-faint"
                }`}
              >
                {medal[i] ?? i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {e.username}
                  </span>
                  <span className="tnum shrink-0 text-sm font-semibold">
                    {by === "voice" ? fmtDuration(e.voiceSeconds) : fmtNum(e.xp)}
                  </span>
                </div>
                <div className="mt-1.5">
                  <Meter pct={e.pct} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-faint">
                  <span>เลเวล {e.level}</span>
                  <span className="tnum">
                    {by === "voice"
                      ? `${fmtNum(e.messages)} ข้อความ`
                      : `${e.xpIntoLevel}/${e.xpForNext} XP`}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
