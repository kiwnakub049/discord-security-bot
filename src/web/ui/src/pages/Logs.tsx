import { useCallback, useEffect, useRef, useState } from "react";
import { api, qs } from "../lib/api";
import type {
  LogEntry,
  LogLevel,
  LogPage,
  PartnerBot,
  Verdict,
  VerdictStats,
} from "../lib/types";
import { Button, Chip, ChipRow, Empty, SearchBox, Spinner } from "../components/ui";
import { LogRow } from "../components/LogRow";
import { LogTree } from "../components/LogTree";
import { iconOf, labelOf } from "../lib/categories";
import { findLeaf, type LogFilter } from "../lib/logTree";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";

const LEVELS: { v: LogLevel | ""; label: string }[] = [
  { v: "", label: "ทุกระดับ" },
  { v: "alert", label: "แจ้งเตือน" },
  { v: "warn", label: "เตือน" },
  { v: "info", label: "ปกติ" },
];

/** ต้องตรงกับ WINDOWS ใน src/web/routes/logs.ts */
const WINDOWS = [
  { v: "", label: "ทุกเวลา" },
  { v: "1h", label: "1 ชม." },
  { v: "24h", label: "24 ชม." },
  { v: "7d", label: "7 วัน" },
] as const;

const PAGE = 40;

export function Logs({
  latest,
  filter,
  onPickFilter,
  guildId,
}: {
  latest: LogEntry | null;
  filter: LogFilter;
  onPickFilter: (f: LogFilter) => void;
  guildId: string | null;
}) {
  const toast = useToast();
  const category = filter.category;
  const leaf = findLeaf(filter.leaf);
  const [level, setLevel] = useState<LogLevel | "">("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [window_, setWindow] = useState("");
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

  // กิ่งระบุ event ได้หลายตัว เลยต่อเป็น ?event=a,b เอง แทนที่จะยัดผ่าน qs()
  const query =
    qs({ category, level, search: debounced, window: window_, limit: PAGE }) +
    (leaf ? `&event=${leaf.events.join(",")}` : "");

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
    if (category && latest.category !== category) return;
    if (leaf && !leaf.events.includes(latest.event)) return;
    if (level && latest.level !== level) return;
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
  }, [latest, category, leaf, level, debounced]);

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

  /** ชื่อของสิ่งที่กำลังดูอยู่ — โชว์บนหัวปุ่มกางต้นไม้ */
  const pickedLabel = leaf
    ? leaf.label
    : category
      ? labelOf(category)
      : "ทุกหมวด";

  return (
    <div className="space-y-4">
      {/*
        ---- ต้นไม้หมวดหมู่ (เฉพาะมือถือ) ----
        จอใหญ่มีต้นไม้อยู่ในเมนูซ้ายแล้ว ตรงนี้เลยซ่อนที่ md ขึ้นไป
        ย่อไว้ก่อนเพราะกางค้างไว้จะกินครึ่งจอ เหลือที่ให้รายการจริงน้อยเกินไป
      */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen}
          className="press flex w-full items-center gap-2.5 rounded-md border border-line bg-surface px-3.5 py-3 text-sm shadow-[inset_0_1px_0_0_var(--glass-spec)]"
        >
          <Icon
            name={leaf?.icon ?? (category ? iconOf(category) : "list")}
            className="size-[18px] shrink-0 text-accent"
          />
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {pickedLabel}
          </span>
          {category && (
            <span className="shrink-0 text-xs text-faint">{labelOf(category)}</span>
          )}
          <Icon
            name="chevron"
            className={`size-4 shrink-0 text-faint transition-transform duration-200 ${
              treeOpen ? "rotate-90" : ""
            }`}
          />
        </button>

        {treeOpen && (
          <div className="fade-in mt-2 rounded-md border border-line bg-surface p-2 shadow-[inset_0_1px_0_0_var(--glass-spec)]">
            <LogTree
              filter={filter}
              onPick={(f) => {
                onPickFilter(f);
                // เลือกกิ่งแล้วหุบเอง — บนมือถือถ้าค้างไว้ต้องเลื่อนผ่านต้นไม้ทุกครั้ง
                if (f.leaf) setTreeOpen(false);
              }}
              compact
            />
          </div>
        )}
      </div>

      {/* ---- ตัวกรอง ---- */}
      <div className="space-y-2.5">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="ค้นหาหัวข้อ / รายละเอียด / ชื่อผู้ใช้…"
        />
        <ChipRow>
          {LEVELS.map((l) => (
            <Chip key={l.v} active={level === l.v} onClick={() => setLevel(l.v)}>
              {l.label}
            </Chip>
          ))}
          <span className="w-px shrink-0 self-stretch bg-line" />
          {WINDOWS.map((w) => (
            <Chip key={w.v} active={window_ === w.v} onClick={() => setWindow(w.v)}>
              {w.label}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {/* ---- อธิบายว่าหมวดพาร์ทเนอร์คือใคร ---- */}
      {category === "partner" && partners.length > 0 && (
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
          href={`/api/logs/export.csv${qs({ category, level, search: debounced, window: window_ })}${leaf ? `&event=${leaf.events.join(",")}` : ""}`}
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
