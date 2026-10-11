import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, uploadTeamFile } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import type { TeamFile, TeamMessage, TeamPerson, TeamRoomSummary } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Spinner } from "../components/ui";
import { useToast } from "../components/Toast";

/**
 * แชททีม — admin/mod คุยกัน: ห้องรวม + คุยส่วนตัวสองคน
 * ส่งรูป/ไฟล์ได้ (ไม่เกิน 100 MB ต่อไฟล์) และพิมพ์ @ เพื่อแท็ก — คนที่ถูกแท็กได้ DM จากบอทด้วย
 *
 * ไม่ได้ต่อสตรีมสด ใช้ดึงข้อความใหม่ทุก 3 วิ ตอนเปิดห้องอยู่ (แชทเล็ก ๆ ในทีม พอแล้ว)
 */

const GENERAL = "general";
const POLL_MS = 3000;
const MAX_FILE = 100_000_000;
const MAX_FILES = 10;

const dmRoom = (a: string, b: string) => {
  const [lo, hi] = [a, b].sort();
  return `dm:${lo}:${hi}`;
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ข้อความ + ไฮไลต์ @ชื่อ ของคนที่ถูกแท็กจริง (ไม่ใช้ innerHTML) */
function Body({ text, names, mine }: { text: string; names: string[]; mine: boolean }) {
  if (!text) return null;
  const parts: ReactNode[] = names.length
    ? text.split(new RegExp(`(${names.map((n) => `@${escapeRe(n)}`).join("|")})`, "g")).map((p, i) =>
        names.some((n) => `@${n}` === p) ? (
          <span
            key={i}
            className={`rounded px-0.5 font-semibold ${mine ? "bg-surface/25" : "bg-accent-soft text-accent"}`}
          >
            {p}
          </span>
        ) : (
          p
        ),
      )
    : [text];
  return <p className="whitespace-pre-wrap break-words text-sm">{parts}</p>;
}

function Attachment({ f }: { f: TeamFile }) {
  const src = `/api/team/files/${f.id}`;
  if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        <img
          src={src}
          alt={f.name}
          loading="lazy"
          className="max-h-64 max-w-full rounded-md border border-line bg-raised object-contain"
        />
      </a>
    );
  }
  if (/^video\/(mp4|webm)$/.test(f.mime)) {
    return <video src={src} controls preload="metadata" className="max-h-72 max-w-full rounded-md" />;
  }
  if (/^audio\//.test(f.mime)) return <audio src={src} controls preload="metadata" className="max-w-full" />;
  return (
    <a
      href={`${src}?download=1`}
      className="flex max-w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-text hover:bg-raised"
    >
      <Icon name="download" className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      <span className="tnum shrink-0 text-xs text-faint">{fmtSize(f.size)}</span>
    </a>
  );
}

interface Pending {
  key: string;
  file: File;
  progress: number;
  id?: string;
  error?: string;
}

export function Team({ userId }: { userId: string }) {
  const toast = useToast();
  const people = useFetch<TeamPerson[]>("/api/team/people", 60_000);
  const rooms = useFetch<TeamRoomSummary[]>("/api/team/rooms", 10_000);
  const [room, setRoom] = useState<string | null>(() => {
    const q = new URLSearchParams(window.location.search).get("room");
    return q ?? (window.matchMedia("(min-width: 768px)").matches ? GENERAL : null);
  });

  const staff = people.data ?? [];
  const byId = useMemo(() => new Map(staff.map((p) => [p.id, p])), [staff]);
  const summary = useMemo(
    () => new Map((rooms.data ?? []).map((r) => [r.room, r])),
    [rooms.data],
  );

  const roomList = [
    { room: GENERAL, label: "ห้องรวม", person: null as TeamPerson | null },
    ...staff
      .filter((p) => p.id !== userId)
      .map((p) => ({ room: dmRoom(userId, p.id), label: p.name, person: p })),
  ].sort((a, b) => {
    // ห้องรวมอยู่บนสุดเสมอ ที่เหลือเรียงตามข้อความล่าสุด
    if (a.room === GENERAL) return -1;
    if (b.room === GENERAL) return 1;
    return (summary.get(b.room)?.lastId ?? 0) - (summary.get(a.room)?.lastId ?? 0);
  });

  const current = roomList.find((r) => r.room === room) ?? null;
  const members =
    room === GENERAL ? staff.filter((p) => p.id !== userId) : current?.person ? [current.person] : [];

  return (
    <div className="flex h-[calc(100dvh-10.5rem)] gap-4 md:h-[calc(100dvh-7.5rem)]">
      {/* ---- รายชื่อห้อง ---- */}
      <aside
        className={`${room ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col overflow-y-auto rounded-md border border-line bg-surface md:w-64`}
      >
        {roomList.map((r) => {
          const s = summary.get(r.room);
          const active = r.room === room;
          return (
            <button
              key={r.room}
              type="button"
              onClick={() => setRoom(r.room)}
              aria-current={active ? "true" : undefined}
              className={`press flex items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 ${
                active ? "bg-accent-soft" : "hover:bg-raised"
              }`}
            >
              {r.person ? (
                <Avatar id={r.person.id} name={r.person.name} size="md" />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-surface">
                  <Icon name="users" className="size-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`truncate text-sm ${s?.unread ? "font-bold" : "font-medium"}`}>{r.label}</span>
                  {r.person?.role === "admin" && (
                    <span className="shrink-0 rounded bg-raised px-1 text-[10px] text-muted">admin</span>
                  )}
                </span>
                <span className="block truncate text-xs text-faint">
                  {s?.lastText ?? (r.room === GENERAL ? "ทุกคนในทีม" : "ยังไม่เคยคุยกัน")}
                </span>
              </span>
              {s && s.unread > 0 && (
                <span
                  className={`tnum shrink-0 rounded-full px-1.5 text-xs font-semibold leading-5 text-surface ${
                    s.mentioned ? "bg-alert" : "bg-accent"
                  }`}
                >
                  {s.mentioned ? "@" : ""}
                  {s.unread}
                </span>
              )}
            </button>
          );
        })}
        {people.loading && (
          <div className="flex justify-center py-4 text-muted">
            <Spinner />
          </div>
        )}
      </aside>

      {/* ---- ห้องที่เปิดอยู่ ---- */}
      {room && current ? (
        <Conversation
          key={room}
          room={room}
          title={current.label}
          person={current.person}
          userId={userId}
          members={members}
          byId={byId}
          onBack={() => setRoom(null)}
          onRead={() => rooms.reload()}
          toast={toast}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-muted md:flex">
          เลือกห้องทางซ้าย
        </div>
      )}
    </div>
  );
}

function Conversation({
  room,
  title,
  person,
  userId,
  members,
  byId,
  onBack,
  onRead,
  toast,
}: {
  room: string;
  title: string;
  person: TeamPerson | null;
  userId: string;
  /** คนที่แท็กได้ในห้องนี้ (ไม่รวมตัวเอง) */
  members: TeamPerson[];
  byId: Map<string, TeamPerson>;
  onBack: () => void;
  onRead: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastId = useRef(0);
  const readId = useRef(0);

  const atBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const toBottom = () =>
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  const markRead = useCallback(() => {
    if (document.hidden || lastId.current <= readId.current) return;
    readId.current = lastId.current;
    void api.post("/api/team/read", { room, lastId: lastId.current }).then(onRead, () => {});
  }, [room, onRead]);

  // โหลดครั้งแรก
  useEffect(() => {
    let alive = true;
    api
      .get<TeamMessage[]>(`/api/team/messages?room=${encodeURIComponent(room)}`)
      .then((list) => {
        if (!alive) return;
        setMessages(list);
        setHasOlder(list.length >= 50);
        lastId.current = list.at(-1)?.id ?? 0;
        toBottom();
        markRead();
      })
      .catch((err) => toast(err instanceof Error ? err.message : "โหลดข้อความไม่สำเร็จ", "error"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [room, toast, markRead]);

  // ดึงข้อความใหม่เรื่อย ๆ
  useEffect(() => {
    const t = window.setInterval(async () => {
      if (document.hidden || loading) return;
      try {
        const fresh = await api.get<TeamMessage[]>(
          `/api/team/messages?room=${encodeURIComponent(room)}&after=${lastId.current}`,
        );
        if (!fresh.length) return;
        const stick = atBottom();
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...fresh.filter((m) => !seen.has(m.id))];
        });
        lastId.current = Math.max(lastId.current, fresh.at(-1)!.id);
        if (stick) {
          toBottom();
          markRead();
        }
      } catch {
        /* เน็ตสะดุด — รอบหน้าลองใหม่ */
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [room, loading, markRead]);

  async function loadOlder() {
    const first = messages[0]?.id;
    if (!first) return;
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    const older = await api.get<TeamMessage[]>(
      `/api/team/messages?room=${encodeURIComponent(room)}&before=${first}`,
    );
    setHasOlder(older.length >= 50);
    setMessages((prev) => [...older, ...prev]);
    // คงตำแหน่งที่อ่านอยู่ ไม่ให้กระโดด
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - before;
    });
  }

  // ---- ไฟล์แนบ ----
  function addFiles(list: FileList | File[]) {
    const files = [...list];
    const room_ = MAX_FILES - pending.length;
    if (files.length > room_) toast(`แนบได้ไม่เกิน ${MAX_FILES} ไฟล์ต่อข้อความ`, "error");
    for (const file of files.slice(0, Math.max(0, room_))) {
      if (file.size > MAX_FILE) {
        toast(`${file.name} ใหญ่เกิน 100 MB`, "error");
        continue;
      }
      const key = `${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { key, file, progress: 0 }]);
      uploadTeamFile(file, (progress) =>
        setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))),
      )
        .then(({ id }) => setPending((p) => p.map((x) => (x.key === key ? { ...x, id, progress: 1 } : x))))
        .catch((err) =>
          setPending((p) =>
            p.map((x) =>
              x.key === key ? { ...x, error: err instanceof Error ? err.message : "อัปไม่สำเร็จ" } : x,
            ),
          ),
        );
    }
  }

  // ---- แท็ก ----
  function onType(value: string, caret: number) {
    setText(value);
    const m = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setMentionQuery(m ? m[1]!.toLowerCase() : null);
  }
  const candidates =
    mentionQuery === null
      ? []
      : members
          .filter(
            (p) =>
              p.name.toLowerCase().includes(mentionQuery) || p.username.toLowerCase().includes(mentionQuery),
          )
          .slice(0, 6);
  function pickMention(p: TeamPerson) {
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const head = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${p.name} `);
    const next = head + text.slice(caret);
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(head.length, head.length);
    });
  }

  const uploading = pending.some((p) => !p.id && !p.error);
  const ready = pending.filter((p) => p.id);

  async function send() {
    const body = text.trim();
    if (sending || uploading || (!body && !ready.length)) return;
    // แท็กใครบ้าง = ชื่อ @ของคนในห้องที่ยังอยู่ในข้อความตอนกดส่ง
    const mentions = members.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    setSending(true);
    try {
      const r = await api.post<{ ok: boolean; message: TeamMessage }>("/api/team/messages", {
        room,
        body,
        files: ready.map((p) => p.id),
        mentions,
      });
      setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message]));
      lastId.current = Math.max(lastId.current, r.message.id);
      readId.current = lastId.current;
      setText("");
      setPending([]);
      toBottom();
      onRead();
    } catch (err) {
      toast(err instanceof Error ? err.message : "ส่งไม่สำเร็จ", "error");
    } finally {
      setSending(false);
    }
  }

  const nameOf = (m: TeamMessage) => byId.get(m.authorId)?.name ?? m.authorName;

  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-line bg-surface"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {/* หัวห้อง */}
      <header className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="กลับไปรายชื่อห้อง"
          className="press -ml-1 rounded-md p-1.5 text-muted hover:bg-raised md:hidden"
        >
          <Icon name="chevron" className="size-4 rotate-180" />
        </button>
        {person ? (
          <Avatar id={person.id} name={person.name} size="sm" />
        ) : (
          <Icon name="users" className="size-5 text-accent" />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-xs text-faint">
            {person ? `คุยส่วนตัว · ${person.role}` : `ทีมทั้งหมด ${members.length + 1} คน`}
          </div>
        </div>
      </header>

      {/* ข้อความ */}
      <div ref={scroller} className="flex-1 space-y-1 overflow-y-auto px-3 py-3" onScroll={() => atBottom() && markRead()}>
        {loading ? (
          <div className="flex justify-center py-10 text-muted">
            <Spinner />
          </div>
        ) : (
          <>
            {hasOlder && (
              <button
                type="button"
                onClick={() => void loadOlder()}
                className="press mx-auto mb-2 block rounded-md px-3 py-1 text-xs text-accent hover:bg-raised"
              >
                โหลดข้อความเก่ากว่านี้
              </button>
            )}
            {messages.length === 0 && (
              <p className="py-10 text-center text-sm text-faint">
                ยังไม่มีข้อความ — พิมพ์ @ เพื่อแท็กคนในทีม
              </p>
            )}
            {messages.map((m, i) => {
              const mine = m.authorId === userId;
              const prev = messages[i - 1];
              const head = !prev || prev.authorId !== m.authorId || m.createdAt - prev.createdAt > 5 * 60_000;
              const mentionNames = m.mentions.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);
              const pingsMe = m.mentions.includes(userId);
              return (
                <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""} ${head ? "pt-2" : ""}`}>
                  <div className="w-7 shrink-0">
                    {head && !mine && <Avatar id={m.authorId} name={nameOf(m)} size="sm" />}
                  </div>
                  <div className={`flex min-w-0 max-w-[80%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                    {head && (
                      <div className="flex items-baseline gap-2 px-1 text-xs">
                        {!mine && <span className="font-semibold text-text">{nameOf(m)}</span>}
                        <span className="text-faint" title={new Date(m.createdAt).toLocaleString("th-TH")}>
                          {fmtTime(m.createdAt)}
                        </span>
                      </div>
                    )}
                    {m.body && (
                      <div
                        className={`rounded-lg px-3 py-1.5 ${
                          mine
                            ? "bg-accent text-surface"
                            : pingsMe
                              ? "border border-warn bg-warn-soft"
                              : "bg-raised"
                        }`}
                      >
                        <Body text={m.body} names={mentionNames} mine={mine} />
                      </div>
                    )}
                    {m.files.map((f) => (
                      <Attachment key={f.id} f={f} />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ช่องพิมพ์ */}
      <div className="relative border-t border-line p-2.5">
        {candidates.length > 0 && (
          <div className="absolute inset-x-2.5 bottom-full mb-1 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
            {candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // ไม่ให้ช่องพิมพ์หลุดโฟกัสก่อนเลือก
                  pickMention(p);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-raised"
              >
                <Avatar id={p.id} name={p.name} size="xs" />
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-faint">{p.username}</span>
                {p.role === "admin" && <span className="ml-auto text-[10px] text-muted">admin</span>}
              </button>
            ))}
          </div>
        )}

        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pending.map((p) => (
              <span
                key={p.key}
                className={`relative flex max-w-[14rem] items-center gap-1.5 overflow-hidden rounded-md border px-2 py-1 text-xs ${
                  p.error ? "border-alert text-alert" : "border-line"
                }`}
              >
                {!p.id && !p.error && (
                  <span
                    className="absolute inset-y-0 left-0 bg-accent-soft"
                    style={{ width: `${Math.round(p.progress * 100)}%` }}
                    aria-hidden="true"
                  />
                )}
                <span className="relative min-w-0 truncate">{p.error ? `${p.file.name} — ${p.error}` : p.file.name}</span>
                <span className="relative tnum shrink-0 text-faint">
                  {p.id || p.error ? fmtSize(p.file.size) : `${Math.round(p.progress * 100)}%`}
                </span>
                <button
                  type="button"
                  onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}
                  aria-label={`เอา ${p.file.name} ออก`}
                  className="relative shrink-0 text-faint hover:text-text"
                >
                  <Icon name="x" className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            aria-label="แนบไฟล์หรือรูป"
            title="แนบไฟล์หรือรูป (ไม่เกิน 100 MB)"
            className="press shrink-0 rounded-md p-2 text-muted hover:bg-raised hover:text-text"
          >
            <Icon name="upload" className="size-5" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={input}
            value={text}
            rows={1}
            maxLength={4000}
            placeholder={person ? `ส่งถึง ${title}…` : "พิมพ์ข้อความ… (@ เพื่อแท็ก)"}
            onChange={(e) => onType(e.target.value, e.target.selectionStart)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (candidates.length && (e.key === "Enter" || e.key === "Tab")) {
                e.preventDefault();
                pickMention(candidates[0]!);
              } else if (e.key === "Escape") {
                setMentionQuery(null);
              } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || uploading || (!text.trim() && !ready.length)}
            aria-label="ส่ง"
            className="press shrink-0 rounded-md bg-accent p-2 text-surface disabled:opacity-40"
          >
            {sending ? <Spinner className="size-5" /> : <Icon name="message" className="size-5" />}
          </button>
        </div>
        <p className="mt-1 hidden text-[11px] text-faint md:block">
          Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ · ลากไฟล์มาวาง หรือวางรูปจากคลิปบอร์ดได้ · เก็บ 90 วัน
        </p>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-semibold text-accent">
          วางไฟล์เพื่อแนบ
        </div>
      )}
    </section>
  );
}
