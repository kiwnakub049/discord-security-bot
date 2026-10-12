import { lang, t } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { api, ApiError } from "../lib/api";
import { fmtDuration, fmtNum } from "../lib/format";
import type { QueueCategoryMeta, QueueItem, QueueStack, QueueSummary } from "../lib/types";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { TicketThread } from "./TicketThread";
import { Spinner } from "./ui";
import { useToast } from "./Toast";
import { Avatar } from "./Avatar";

/**
 * แถบ "รอดำเนินการ" — สิ่งแรกที่เห็นบนหน้าแรก
 *
 * หนึ่งหมวด = หนึ่งกองการ์ด ใบบนสุดคือเรื่องที่รอนานที่สุดในหมวด
 * ใบที่เหลือโผล่ขอบอยู่ข้างหลัง ความหนาของกองบอกคร่าว ๆ ว่ามีงานค้างมากแค่ไหน
 * กดกองแล้วแผ่นตัดสินเลื่อนขึ้นมา ตัดสินทีละเรื่องได้โดยไม่ต้องออกจากหน้าแรก
 *
 * หมวดที่ว่างไม่วาดเป็นการ์ดเลข 0 — ยุบเป็นบรรทัดเดียวข้างล่าง
 * สายตาจะได้ไปลงที่งานที่ค้างจริงเท่านั้น
 */

/** มือถือโชว์ 3 กองแรก ที่เหลือพับไว้ (จอใหญ่โชว์หมด) */
const MOBILE_VISIBLE = 3;

/** หน่วยจาก server เป็นพหูพจน์ ("tickets") — อังกฤษ 1 รายการตัด s ทิ้ง (ไทยไม่มีพหูพจน์) */
const unitFor = (unit: string, n: number): string => (lang === "en" && n === 1 ? unit.replace(/s$/, "") : unit);

const waitText = (since: number, now: number): string =>
  fmtDuration(Math.max(0, (now - since) / 1000));

const isOverdue = (since: number, overdueAfterMin: number, now: number): boolean =>
  now - since > overdueAfterMin * 60_000;

export function PriorityQueue() {
  const q = useFetch<QueueSummary>("/api/queue", 15_000);
  const [open, setOpen] = useState<QueueCategoryMeta | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (q.loading && !q.data) {
    return (
      <section aria-labelledby="queue-h" className="flex h-32 items-center justify-center text-muted">
        <h2 id="queue-h" className="sr-only">{t("รอดำเนินการ")}</h2>
        <Spinner />
      </section>
    );
  }
  if (!q.data) {
    return (
      <section aria-labelledby="queue-h" className="rule-l rule-warn rounded-md border border-line bg-surface p-4">
        <h2 id="queue-h" className="text-sm font-semibold">{t("โหลดคิวรอดำเนินการไม่ได้")}</h2>
        <p className="text-sm text-muted">{q.error} — {t("ระบบจะลองใหม่เองทุก 15 วินาที")}</p>
      </section>
    );
  }

  const { stacks, idle } = q.data;
  // ใช้เวลาฝั่งเครื่องตัวเอง ไม่ใช่ q.data.now — ตัวเลข "รอนาน" ต้องเดินต่อระหว่างรอบดึงข้อมูล
  const now = Date.now();
  const total = stacks.reduce((n, s) => n + s.count, 0);

  return (
    <section aria-labelledby="queue-h">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="queue-h" className="text-xl font-semibold">
          {t("รอดำเนินการ")}
        </h2>
        {total > 0 && (
          <p className="text-sm text-muted">
            <span className="tnum font-semibold text-text">{fmtNum(total)}</span>{" "}
            {t("เรื่อง ใน {n} หมวด", { n: stacks.length })}
          </p>
        )}
      </div>

      {stacks.length === 0 ? (
        <div className="rule-l rule-info flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-5">
          <Icon name="shield-check" className="size-6 shrink-0 text-accent" />
          <div>
            <p className="font-semibold">{t("ไม่มีงานค้าง")}</p>
            <p className="text-sm text-muted">
              {t("ทุกคิวว่างอยู่ เรื่องใหม่จะขึ้นที่นี่ทันทีที่บอทส่งเข้ามา")}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {stacks.map((s, i) => (
            <div
              key={s.key}
              className={!expanded && i >= MOBILE_VISIBLE ? "hidden sm:block" : undefined}
            >
              <Deck stack={s} now={now} onOpen={() => setOpen(s)} />
            </div>
          ))}
          {!expanded && stacks.length > MOBILE_VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="press rounded-md border border-dashed border-line py-3 text-sm font-medium text-accent sm:hidden"
            >
              {t("ดูอีก {n} หมวด", { n: stacks.length - MOBILE_VISIBLE })}
            </button>
          )}
        </div>
      )}

      {stacks.length > 0 && idle.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-faint">
          <Icon name="check" className="size-4 shrink-0" />
          {t("ไม่มีอะไรค้าง:")} {idle.map((c) => c.label).join(", ")}
        </p>
      )}

      <QueueSheet category={open} onClose={() => setOpen(null)} onChanged={q.reload} />
    </section>
  );
}

/**
 * กองการ์ดหนึ่งหมวด
 *
 * ชั้นหลังวาดเป็นกล่องเปล่าที่เลื่อนลงทีละ 6px และหดเข้าข้างละ 8px — แค่ "ขอบกระดาษ"
 * ไม่ใส่เนื้อหาเพราะคนอ่านแค่ใบบน ส่วนจำนวนชั้นสูงสุด 2 (มากกว่านั้นตาแยกไม่ออกแล้ว
 * ตัวเลขบนการ์ดเป็นตัวบอกจำนวนจริง)
 */
function Deck({ stack, now, onOpen }: { stack: QueueStack; now: number; onOpen: () => void }) {
  const layers = Math.min(2, stack.count - 1);
  const top = stack.items[0];
  const overdue = isOverdue(stack.oldestAt, stack.overdueAfterMin, now);
  const rest = stack.count - 1;

  return (
    <div className="relative" style={{ paddingBottom: layers * 8 }}>
      {Array.from({ length: layers }, (_, k) => layers - k).map((depth) => (
        <div
          key={depth}
          aria-hidden="true"
          className="absolute rounded-md border border-line bg-raised"
          style={{
            left: depth * 10,
            right: depth * 10,
            top: depth * 8,
            bottom: (layers - depth) * 8,
            opacity: 1 - (depth - 1) * 0.3,
          }}
        />
      ))}

      <button
        type="button"
        onClick={onOpen}
        aria-label={`${stack.label} ${stack.count} ${stack.unit} — ${stack.verb}`}
        className={`press rule-l rule-${stack.severity} relative flex w-full flex-col rounded-md border border-line bg-surface p-4 text-left transition-colors hover:border-faint`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold leading-snug">{stack.label}</h3>
            <p className={`text-sm ${overdue ? "font-medium text-alert" : "text-faint"}`}>
              {overdue ? t("เกินกำหนด · ") : ""}{t("รอนานสุด {d}", { d: waitText(stack.oldestAt, now) })}
            </p>
          </div>
          <span className="tnum text-4xl font-semibold leading-none tracking-tight">
            {fmtNum(stack.count)}
          </span>
        </div>

        {top && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="flex min-w-0 items-center gap-2 font-medium">
              {top.subjectId && (
                <Avatar id={top.subjectId} name={top.subjectName ?? top.title} size="xs" />
              )}
              <span className="truncate">{top.subjectName ?? top.title}</span>
            </p>
            {top.detail && <p className="line-clamp-2 text-sm text-muted">{top.detail}</p>}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-accent">
            {stack.verb} {fmtNum(stack.count)} {unitFor(stack.unit, stack.count)}
          </span>
          {rest > 0 && (
            <span className="text-faint">
              {t("อีก {n} {unit}ข้างใต้", { n: fmtNum(rest), unit: unitFor(stack.unit, rest) })}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

/**
 * แผ่นตัดสินของหนึ่งหมวด — เรียงเก่าสุดก่อน ตัดสินแล้วรายการเลื่อนหายไป
 *
 * ปุ่มที่ลงมือจริง (แบน) ต้องกดสองครั้ง: ครั้งแรกเปลี่ยนเป็น "กดอีกครั้งเพื่อแบน"
 * ค้างไว้ 4 วินาที — กันนิ้วโป้งพลาดบนมือถือ ซึ่งแบนแล้วย้อนจากหน้านี้ไม่ได้
 */
function QueueSheet({
  category,
  onClose,
  onChanged,
}: {
  category: QueueCategoryMeta | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  // ticket ที่เปิดบทสนทนาอยู่ (ทีละเรื่อง — แผ่นยาวเกินไปถ้าเปิดพร้อมกันหลายเรื่อง)
  const [chatOpen, setChatOpen] = useState<number | null>(null);
  // หมายเหตุที่พิมพ์ค้างไว้ของแต่ละเรื่อง
  const [notes, setNotes] = useState<Record<number, string>>({});
  const armTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!category) return;
    let alive = true;
    setItems(null);
    setError(null);
    setLeaving(new Set());
    setChatOpen(null);
    setNotes({});
    api
      .get<{ items: QueueItem[] }>(`/api/queue/${category.key}`)
      .then((r) => alive && setItems(r.items))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : t("โหลดไม่สำเร็จ")));
    return () => {
      alive = false;
    };
  }, [category]);

  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  if (!category) return null;
  const now = Date.now();
  const remaining = items?.filter((x) => !leaving.has(x.id)) ?? [];

  async function decide(item: QueueItem, outcomeKey: string, dangerous: boolean) {
    const armKey = `${item.id}:${outcomeKey}`;
    if (dangerous && armed !== armKey) {
      setArmed(armKey);
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(null), 4000);
      return;
    }
    setArmed(null);
    setBusy(item.id);
    try {
      const r = await api.post<{ ok: boolean; message: string }>(`/api/queue/${item.id}/resolve`, {
        outcome: outcomeKey,
        ...(category?.note && notes[item.id]?.trim() ? { note: notes[item.id]!.trim() } : {}),
      });
      toast(r.message, r.ok ? "ok" : "error");
      setLeaving((s) => new Set(s).add(item.id));
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("ทำรายการไม่สำเร็จ"), "error");
      // 409 = คนอื่นตัดสินไปแล้ว — เอาออกจากรายการเหมือนกัน ไม่ต้องให้กดซ้ำ
      if (e instanceof ApiError && e.status === 409) {
        setLeaving((s) => new Set(s).add(item.id));
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span>
          {category.label}
          {items && (
            <span className="ml-2 font-normal text-muted">
              {fmtNum(remaining.length)} {unitFor(category.unit, remaining.length)}
            </span>
          )}
        </span>
      }
    >
      {error ? (
        <p className="py-8 text-center text-sm text-alert">{error}</p>
      ) : !items ? (
        <div className="flex justify-center py-10 text-muted">
          <Spinner />
        </div>
      ) : remaining.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Icon name="shield-check" className="size-8 text-accent" />
          <p className="font-semibold">{t("หมวดนี้ว่างแล้ว")}</p>
          <button type="button" onClick={onClose} className="press text-sm font-medium text-accent">
            {t("กลับหน้าแรก")}
          </button>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {items.map((item) => {
            const gone = leaving.has(item.id);
            const overdue = isOverdue(item.createdAt, category.overdueAfterMin, now);
            return (
              <li
                key={item.id}
                className={`py-4 first:pt-1 ${gone ? "leave pointer-events-none" : ""}`}
                onAnimationEnd={() =>
                  gone && setItems((xs) => xs?.filter((x) => x.id !== item.id) ?? null)
                }
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-2 font-semibold">
                    {item.subjectId && (
                      <Avatar id={item.subjectId} name={item.subjectName ?? item.title} size="sm" />
                    )}
                    <span className="truncate">{item.subjectName ?? item.title}</span>
                  </p>
                  <span
                    className={`shrink-0 text-xs ${overdue ? "font-medium text-alert" : "text-faint"}`}
                  >
                    {t("รอ {d}", { d: waitText(item.createdAt, now) })}
                  </span>
                </div>
                {item.subjectName && item.subjectName !== item.title && (
                  <p className="text-sm">{item.title}</p>
                )}
                {/* ticket: รายละเอียด = ข้อความแรกของบทสนทนา เปิดแชทอยู่ก็ไม่ต้องโชว์ซ้ำ */}
                {item.detail && chatOpen !== item.id && (
                  <p className="text-sm text-muted">{item.detail}</p>
                )}
                {item.hits > 1 && (
                  <p className="text-xs font-medium text-warn">
                    {t("โดนจับรวม {n} ครั้ง — ดูทุกข้อความได้ในหน้า Logs", { n: fmtNum(item.hits) })}
                  </p>
                )}
                {item.subjectId && (
                  <p className="font-mono text-xs text-faint">{item.subjectId}</p>
                )}

                {category.note && (
                  <input
                    type="text"
                    value={notes[item.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                    maxLength={300}
                    placeholder={t("หมายเหตุ (ไม่บังคับ) — ส่งถึงสมาชิกเป็นเหตุผลถ้าเตือน/timeout")}
                    aria-label={t("หมายเหตุสำหรับ {name}", { name: item.subjectName ?? item.title })}
                    className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                )}

                {category.key === "admin-ticket" && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        aria-expanded={chatOpen === item.id}
                        onClick={() => setChatOpen((c) => (c === item.id ? null : item.id))}
                        className="press inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium"
                      >
                        <Icon name="message" className="size-4" />
                        {chatOpen === item.id ? t("ซ่อนบทสนทนา") : t("เปิดบทสนทนา")}
                        {item.thread && (
                          <span className="text-muted">({fmtNum(item.thread.count)})</span>
                        )}
                      </button>
                      {/* ตำรวจพูดล่าสุด = รอแอดมินตอบ — เด่นกว่าเรื่องที่แอดมินตอบไปแล้ว */}
                      {item.thread?.lastFrom === "police" && item.thread.count > 1 && (
                        <span className="rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                          {t("ตำรวจตอบมา {d}ที่แล้ว", { d: waitText(item.thread.lastAt, now) })}
                        </span>
                      )}
                      {item.thread?.lastFrom === "admin" && (
                        <span className="text-xs text-faint">{t("รอตำรวจตอบ")}</span>
                      )}
                    </div>
                    {chatOpen === item.id && <TicketThread id={item.id} onSent={onChanged} />}
                  </>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {category.outcomes.map((o) => {
                    const dangerous = o.tone === "danger";
                    const isArmed = armed === `${item.id}:${o.key}`;
                    const cls =
                      o.tone === "danger"
                        ? isArmed
                          ? "border-alert bg-alert text-surface"
                          : "border-alert/50 text-alert"
                        : o.tone === "accent"
                          ? "border-accent bg-accent text-surface"
                          : "border-line text-text";
                    return (
                      <button
                        key={o.key}
                        type="button"
                        disabled={busy === item.id}
                        onClick={() => void decide(item, o.key, dangerous)}
                        className={`press min-h-10 rounded-md border px-3.5 text-sm font-medium disabled:opacity-40 ${cls}`}
                      >
                        {isArmed ? t("กดอีกครั้งเพื่อ{label}", { label: o.label }) : o.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}
