import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type {
  LogEntry,
  LogPage,
  PartnerBot,
  Verdict,
  VerdictStats,
} from "../lib/types";
import { Button, Empty, SearchBox, Spinner } from "../components/ui";
import { LogRow } from "../components/LogRow";
import {
  CategoryTabs,
  LEVEL_OPTIONS,
  LogFilterPanel,
  WINDOW_OPTIONS,
} from "../components/LogTree";
import {
  EMPTY_FILTER,
  activeCount,
  filterParams,
  leavesOf,
  matchesFilter,
  toggleLeaf,
  toggleLevel,
  type LogFilter,
} from "../lib/logTree";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";

const PAGE = 40;

export function Logs({
  latest,
  filter,
  onFilterChange,
  guildId,
}: {
  latest: LogEntry | null;
  filter: LogFilter;
  onFilterChange: (f: LogFilter) => void;
  guildId: string | null;
}) {
  const toast = useToast();
  // จอใหญ่กางแผงตัวกรองไว้ตั้งแต่แรก มือถือหุบไว้ก่อน (กางค้างจะกินเกือบทั้งจอ)
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [vstats, setVstats] = useState<VerdictStats | null>(null);
  const [partners, setPartners] = useState<PartnerBot[]>([]);
  /** id ของรายการที่เพิ่งไหลเข้ามาสด ๆ — ใช้ทำกรอบไฮไลต์ */
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  // หน่วงคำค้น 300 มิลลิวินาที — พิมพ์แต่ละตัวอักษรไม่ควรยิง API หนึ่งครั้ง
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const params = filterParams(filter, debounced);
  const query = `?${params ? `${params}&` : ""}limit=${PAGE}`;

  const loadFirst = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.get<LogPage>(`/api/logs${query}`);
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลด logs ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    api
      .get<{ map: Record<number, Verdict>; stats: VerdictStats }>("/api/ai/verdicts")
      .then((r) => {
        setVerdicts(r.map);
        setVstats(r.stats);
      })
      .catch(() => {
        /* ไม่ใช่ข้อมูลหลักของหน้า ถ้าดึงไม่ได้ก็แค่ไม่โชว์ปุ่มตัดสิน */
      });

    api
      .get<PartnerBot[]>("/api/partners")
      .then(setPartners)
      .catch(() => {
        /* ไม่มีทะเบียน = ไม่ขึ้นกล่องอธิบาย เท่านั้นเอง */
      });
  }, []);

  // ---- log ใหม่จากสตรีมสด ----
  const seen = useRef(0);
  useEffect(() => {
    if (!latest || latest.id === seen.current) return;
    seen.current = latest.id;
    // ต้องผ่านตัวกรองที่เปิดอยู่ก่อนถึงจะแทรก ไม่งั้นรายการที่โผล่มาจะขัดกับ
    // สิ่งที่ผู้ใช้เลือกดู (เช่นกรอง "แจ้งเตือน" อยู่ แต่มี info เด้งขึ้นหัวรายการ)
    if (!matchesFilter(latest, filter)) return;
    if (debounced) {
      const hay = `${latest.title} ${latest.description ?? ""} ${latest.fields
        .map((f) => f.value)
        .join(" ")}`.toLowerCase();
      if (!hay.includes(debounced.toLowerCase())) return;
    }
    setEntries((prev) => [latest, ...prev]);
    setFresh((prev) => new Set(prev).add(latest.id));
    window.setTimeout(
      () =>
        setFresh((prev) => {
          const next = new Set(prev);
          next.delete(latest.id);
          return next;
        }),
      4000,
    );
  }, [latest, filter, debounced]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<LogPage>(
        `/api/logs${query}&beforeId=${cursor}`,
      );
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      toast(err instanceof Error ? err.message : "โหลดเพิ่มไม่สำเร็จ", "error");
    } finally {
      setLoadingMore(false);
    }
  }

  // โหลดหน้าถัดไปเองเมื่อเลื่อนใกล้ท้ายรายการ — บนมือถือดีกว่าให้กดปุ่มทุกครั้ง
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const io = new IntersectionObserver(
      (rows) => {
        if (rows[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" }, // เริ่มโหลดก่อนถึงจริง ๆ จะได้ไม่เห็นรอยสะดุด
    );
    io.observe(node);
    return () => io.disconnect();
    // จงใจไม่ใส่ loadMore ใน deps — มันถูกสร้างใหม่ทุก render จะทำให้ observer
    // ถูกถอด-ติดใหม่ตลอด ค่าที่มันอ่าน (cursor/query) อยู่ใน deps ครบแล้ว
  }, [hasMore, cursor, loadingMore, query]);

  async function setVerdict(logId: number, v: Verdict | null) {
    // อัปเดตหน้าจอทันทีแล้วค่อยยิง API — ถ้าพลาดค่อยย้อนกลับ
    const before = verdicts[logId] ?? null;
    setVerdicts((prev) => {
      const next = { ...prev };
      if (v) next[logId] = v;
      else delete next[logId];
      return next;
    });
    try {
      const r = await api.post<{ stats: VerdictStats }>("/api/ai/verdict", {
        logId,
        verdict: v,
      });
      setVstats(r.stats);
    } catch (err) {
      setVerdicts((prev) => {
        const next = { ...prev };
        if (before) next[logId] = before;
        else delete next[logId];
        return next;
      });
      toast(err instanceof Error ? err.message : "บันทึกคำตัดสินไม่สำเร็จ", "error");
    }
  }

  const count = activeCount(filter);
  /** รายการที่ติ๊กอยู่ เป็นป้ายกด × ได้ — เรียงตามแผง: ระดับ → เวลา → หัวข้อย่อย */
  const picked: { key: string; label: string; remove: () => void }[] = [
    ...LEVEL_OPTIONS.filter((l) => filter.levels.includes(l.v)).map((l) => ({
      key: `lv-${l.v}`,
      label: l.label,
      remove: () => onFilterChange(toggleLevel(filter, l.v)),
    })),
    ...WINDOW_OPTIONS.filter((w) => w.v && w.v === filter.window).map((w) => ({
      key: "window",
      label: w.label,
      remove: () => onFilterChange({ ...filter, window: "" }),
    })),
    ...leavesOf(filter.category)
      .filter((l) => filter.leaves.includes(l.id))
      .map((l) => ({
        key: `leaf-${l.id}`,
        label: l.label,
        remove: () => onFilterChange(toggleLeaf(filter, l.id)),
      })),
  ];

  return (
    <div className="space-y-4">
      {/* ---- หมวด (แยกจากตัวกรอง) + ค้นหา + ตัวกรองแบบติ๊ก ---- */}
      <div className="space-y-2.5">
        <CategoryTabs filter={filter} onChange={onFilterChange} />
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="ค้นหาหัวข้อ / รายละเอียด / ชื่อผู้ใช้…"
            />
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            className={`press flex shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${
              panelOpen || count > 0
                ? "border-accent bg-accent-soft font-semibold text-accent"
                : "border-line bg-surface text-muted hover:text-text"
            }`}
          >
            <Icon name="list" className="size-4" />
            ตัวกรอง
            {count > 0 && (
              <span className="tnum rounded-full bg-accent px-1.5 text-xs leading-5 text-surface">
                {count}
              </span>
            )}
          </button>
        </div>

        {panelOpen && (
          <div className="fade-in rounded-md border border-line bg-surface p-3 shadow-[inset_0_1px_0_0_var(--glass-spec)]">
            <LogFilterPanel filter={filter} onChange={onFilterChange} />
            {/* มือถือ: แผงยาวเกือบเต็มจอ ติ๊กเสร็จแล้วหุบลงไปดูรายการได้ทันที */}
            <div className="mt-3 md:hidden">
              <Button full onClick={() => setPanelOpen(false)}>
                ดูผลลัพธ์
              </Button>
            </div>
          </div>
        )}

        {/* ที่ติ๊กไว้ — กด × เอาออกทีละอันได้โดยไม่ต้องกางแผง */}
        {count > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {picked.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={p.remove}
                aria-label={`เอาตัวกรอง ${p.label} ออก`}
                className="press flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft py-0.5 pl-2.5 pr-1.5 text-xs text-accent"
              >
                {p.label}
                <Icon name="x" className="size-3" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => onFilterChange({ ...EMPTY_FILTER, category: filter.category })}
              className="press px-1.5 text-xs font-medium text-muted underline-offset-2 hover:underline"
            >
              ล้างทั้งหมด
            </button>
          </div>
        )}
      </div>

      {/* ---- อธิบายว่าหมวดพาร์ทเนอร์คือใคร ---- */}
      {filter.category === "partner" && partners.length > 0 && (
        <div className="fade-in space-y-1.5 rounded-md border border-line bg-surface px-3.5 py-3">
          <p className="text-xs text-muted">
            บอทจากพาร์ทเนอร์ที่เราให้สิทธิ์เข้ามาจัดการในเซิร์ฟเวอร์นี้
          </p>
          {partners.map((p) => (
            <div key={p.id} className="flex items-start gap-2 text-xs">
              <Icon name="bot" className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <div>
                  <b className="text-text">{p.name}</b>
                  <span className="text-muted"> — {p.role}</span>
                </div>
                {/* id ขึ้นบรรทัดใหม่ — 19 หลักยาวเกินจะเบียดอยู่บรรทัดเดียวกันบนจอมือถือ */}
                <div className="tnum mt-0.5 break-all text-faint">{p.id}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- ส่งออก ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {/* ส่งออกตามตัวกรองที่เลือกอยู่ ไม่ใช่แค่แถวที่เลื่อนมาถึง */}
        <a
          href={`/api/logs/export.csv${params ? `?${params}` : ""}`}
          className="flex items-center gap-1 font-medium text-accent"
        >
          <Icon name="download" className="size-3.5" />
          ส่งออก CSV ตามตัวกรอง
        </a>
        {vstats && vstats.total > 0 && (
          <a
            href="/api/ai/export.jsonl"
            download
            className="flex items-center gap-1 font-medium text-accent"
          >
            <Icon name="download" className="size-3.5" />
            ชุดข้อมูลเทรน (.jsonl)
          </a>
        )}
      </div>

      {/* ---- สรุปคำตัดสิน AI ---- */}
      {vstats && vstats.total > 0 && (
        <div className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-xs text-muted">
          mod ตัดสินการตรวจจับของ AI ไปแล้ว{" "}
          <b className="text-text">{vstats.total}</b> รายการ ·{" "}
          <span className="text-alert">ผิดจริง {vstats.toxic}</span> ·{" "}
          <span className="text-ok">AI จับผิดตัว {vstats.ok}</span>
        </div>
      )}

      {/* ---- รายการ ---- */}
      {loading ? (
        <div className="flex justify-center py-16 text-muted">
          <Spinner className="size-6" />
        </div>
      ) : error ? (
        <Empty icon="warn">{error}</Empty>
      ) : entries.length === 0 ? (
        <Empty icon="search">ไม่พบรายการที่ตรงกับเงื่อนไข</Empty>
      ) : (
        <>
          <div className="stagger space-y-2">
            {entries.map((e) => (
              <LogRow
                key={e.id}
                entry={e}
                verdict={verdicts[e.id] ?? null}
                onVerdict={setVerdict}
                isNew={fresh.has(e.id)}
                guildId={guildId}
              />
            ))}
          </div>

          <div ref={sentinel} className="py-2">
            {loadingMore ? (
              <div className="flex justify-center text-muted">
                <Spinner />
              </div>
            ) : hasMore ? (
              <Button full onClick={() => void loadMore()}>
                โหลดเพิ่ม
              </Button>
            ) : (
              <p className="text-center text-xs text-faint">
                หมดแล้ว — ทั้งหมด {entries.length} รายการ
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
