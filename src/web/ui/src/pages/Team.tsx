import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

/** แท็กทุกคนในห้อง — ต้องตรงกับ ALL_RE ใน src/web/routes/team.ts */
const ALL_RE = /(^|\s)@all(?=\s|$)/i;
const ALL: TeamPerson = { id: "all", name: "all", username: "ทุกคนในห้อง", role: "mod" };

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

const isImage = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime);

function Attachment({ f, onOpen }: { f: TeamFile; onOpen: (f: TeamFile) => void }) {
  const src = `/api/team/files/${f.id}`;
  if (isImage(f.mime)) {
    // GIF ขยับเองอยู่แล้ว — กดเพื่อดูใหญ่
    return (
      <button type="button" onClick={() => onOpen(f)} className="block cursor-zoom-in" aria-label={`ดู ${f.name}`}>
        <img
          src={src}
          alt={f.name}
          loading="lazy"
          className="max-h-64 max-w-full rounded-md border border-line bg-raised object-contain"
        />
      </button>
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

/** ดูรูปเต็มจอ — กดพื้นหลัง/× หรือ Esc เพื่อปิด */
function Lightbox({ file, onClose }: { file: TeamFile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const src = `/api/team/files/${file.id}`;
  // portal ไปที่ body — กล่องแชทมี overflow-hidden/animation ที่อาจตัดหรือเลื่อนภาพเต็มจอ
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      onClick={onClose}
      className="fade-in fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
    >
      <img
        src={src}
        alt={file.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[82dvh] max-w-full rounded-md object-contain"
      />
      <div className="flex items-center gap-3 text-sm text-white/90" onClick={(e) => e.stopPropagation()}>
        <span className="max-w-[60vw] truncate">{file.name}</span>
        <span className="tnum text-white/60">{fmtSize(file.size)}</span>
        <a
          href={`${src}?download=1`}
          className="flex items-center gap-1 rounded-md bg-white/15 px-2.5 py-1 hover:bg-white/25"
        >
          <Icon name="download" className="size-4" />
          ดาวน์โหลด
        </a>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="ปิด"
        className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
      >
        <Icon name="x" className="size-5" />
      </button>
    </div>,
    document.body,
  );
}

interface Pending {
  key: string;
  file: File;
  progress: number;
  id?: string;
  error?: string;
  /** รูปที่ยังไม่ส่ง — object URL ของไฟล์ในเครื่อง (คืนหน่วยความจำตอนเอาออก/ส่ง) */
  preview?: string;
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
                  // มีข้อความเข้า = แดงเสมอ (โดนแท็กมี @ นำหน้า)
                  className="tnum shrink-0 rounded-full bg-alert px-1.5 text-xs font-semibold leading-5 text-surface"
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
  const [viewing, setViewing] = useState<TeamFile | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  // กำลังตอบกลับข้อความไหน (แถบเหนือช่องพิมพ์) + ข้อความที่กระพริบหลังกดดูต้นทาง
  const [replying, setReplying] = useState<TeamMessage | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  useEffect(() => setReplying(null), [room]);

  // พรีวิวที่ค้างตอนออกจากห้อง — คืนหน่วยความจำ
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;
  useEffect(
    () => () => pendingRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)),
    [],
  );
  const dropPending = (keys: Set<string> | "all") =>
    setPending((list) => {
      for (const p of list) if (p.preview && (keys === "all" || keys.has(p.key))) URL.revokeObjectURL(p.preview);
      return keys === "all" ? [] : list.filter((p) => !keys.has(p.key));
    });

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
      const preview = isImage(file.type) ? URL.createObjectURL(file) : undefined;
      setPending((p) => [...p, { key, file, progress: 0, ...(preview ? { preview } : {}) }]);
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
      : [...(members.length > 1 || mentionQuery ? [ALL] : []), ...members]
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
    // @all = ทุกคนในห้อง
    const mentions = ALL_RE.test(body)
      ? members.map((p) => p.id)
      : members.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    setSending(true);
    try {
      const r = await api.post<{ ok: boolean; message: TeamMessage }>("/api/team/messages", {
        room,
        body,
        files: ready.map((p) => p.id),
        mentions,
        ...(replying ? { replyTo: replying.id } : {}),
      });
      setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message]));
      lastId.current = Math.max(lastId.current, r.message.id);
      readId.current = lastId.current;
      setText("");
      setReplying(null);
      dropPending("all");
      toBottom();
      onRead();
    } catch (err) {
      toast(err instanceof Error ? err.message : "ส่งไม่สำเร็จ", "error");
    } finally {
      setSending(false);
    }
  }

  const nameOf = (m: TeamMessage) => byId.get(m.authorId)?.name ?? m.authorName;

  function startReply(m: TeamMessage) {
    setReplying(m);
    requestAnimationFrame(() => input.current?.focus());
  }

  /** เลื่อนไปข้อความต้นทางแล้วกระพริบ — ยังไม่ได้โหลด (เก่ากว่าที่โหลดไว้) ก็บอก */
  function jumpTo(id: number) {
    const el = document.getElementById(`team-msg-${id}`);
    if (!el) {
      toast(hasOlder ? "ข้อความนี้เก่ากว่าที่โหลดไว้ — กด \"โหลดข้อความเก่ากว่านี้\" ด้านบน" : "ไม่พบข้อความต้นทางแล้ว", "error");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  }

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
                ยังไม่มีข้อความ — พิมพ์ @ เพื่อแท็กคนในทีม หรือ @all แท็กทุกคน
              </p>
            )}
            {messages.map((m, i) => {
              const mine = m.authorId === userId;
              const prev = messages[i - 1];
              const head = !prev || prev.authorId !== m.authorId || m.createdAt - prev.createdAt > 5 * 60_000;
              const mentionNames = m.mentions.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);
              if (ALL_RE.test(m.body)) mentionNames.push("all");
              const pingsMe = m.mentions.includes(userId);
              return (
                <div
                  key={m.id}
                  id={`team-msg-${m.id}`}
                  className={`group flex gap-2 rounded-md transition-colors duration-500 ${mine ? "flex-row-reverse" : ""} ${
                    head || m.replyTo ? "pt-2" : ""
                  } ${flash === m.id ? "bg-accent-soft" : ""}`}
                >
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
                    {m.replyTo && (
                      <button
                        type="button"
                        onClick={() => m.replyTo && !m.replyTo.gone && jumpTo(m.replyTo.id)}
                        disabled={m.replyTo.gone}
                        title={m.replyTo.gone ? undefined : "ไปที่ข้อความต้นทาง"}
                        className={`flex max-w-full items-center gap-1.5 rounded-md border-l-2 border-accent/60 bg-raised/60 px-2 py-1 text-left text-xs text-muted ${
                          m.replyTo.gone ? "" : "press hover:bg-raised"
                        }`}
                      >
                        <Icon name="reply" className="size-3 shrink-0" />
                        {m.replyTo.gone ? (
                          <span className="italic">ข้อความต้นทางถูกลบไปแล้ว</span>
                        ) : (
                          <>
                            <span className="shrink-0 font-semibold text-text">
                              {(m.replyTo.authorId && byId.get(m.replyTo.authorId)?.name) ?? m.replyTo.authorName}
                            </span>
                            <span className="min-w-0 truncate">
                              {m.replyTo.excerpt || (m.replyTo.files ? `📎 ไฟล์แนบ ${m.replyTo.files} ไฟล์` : "")}
                            </span>
                          </>
                        )}
                      </button>
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
                      <Attachment key={f.id} f={f} onOpen={setViewing} />
                    ))}
                  </div>
                  {/* ตอบกลับ — จอใหญ่โผล่ตอนชี้ · มือถือ (ไม่มี hover) โชว์จาง ๆ ตลอด */}
                  <button
                    type="button"
                    onClick={() => startReply(m)}
                    aria-label={`ตอบกลับ ${nameOf(m)}`}
                    title="ตอบกลับ"
                    className="press self-center rounded-md p-1.5 text-faint opacity-60 hover:bg-raised hover:text-text focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  >
                    <Icon name="reply" className="size-4" />
                  </button>
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
                {p === ALL ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-accent text-surface">
                    <Icon name="users" className="size-3" />
                  </span>
                ) : (
                  <Avatar id={p.id} name={p.name} size="xs" />
                )}
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-faint">{p.username}</span>
                {p.role === "admin" && <span className="ml-auto text-[10px] text-muted">admin</span>}
              </button>
            ))}
          </div>
        )}

        {replying && (
          <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-accent bg-raised/60 px-2.5 py-1.5 text-xs">
            <Icon name="reply" className="size-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted">ตอบกลับ </span>
              <span className="font-semibold">{nameOf(replying)}</span>
              <span className="text-muted">
                {" · "}
                {replying.body || (replying.files.length ? `📎 ไฟล์แนบ ${replying.files.length} ไฟล์` : "")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setReplying(null)}
              aria-label="ยกเลิกการตอบกลับ"
              className="press shrink-0 rounded p-0.5 text-faint hover:text-text"
            >
              <Icon name="x" className="size-3.5" />
            </button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap items-end gap-1.5">
            {pending.map((p) =>
              p.preview ? (
                // รูป/GIF: โชว์ภาพจริงก่อนส่ง (GIF ขยับด้วย) + แถบความคืบหน้าทับด้านล่าง
                <span
                  key={p.key}
                  title={p.error ? `${p.file.name} — ${p.error}` : p.file.name}
                  className={`relative size-20 shrink-0 overflow-hidden rounded-md border bg-raised ${
                    p.error ? "border-alert" : "border-line"
                  }`}
                >
                  <img src={p.preview} alt={p.file.name} className="size-full object-cover" />
                  {!p.id && !p.error && (
                    <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30" aria-hidden="true">
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${Math.round(p.progress * 100)}%` }}
                      />
                    </span>
                  )}
                  {p.error && (
                    <span className="absolute inset-0 flex items-center justify-center bg-alert/70 p-1 text-center text-[10px] font-semibold text-surface">
                      อัปไม่สำเร็จ
                    </span>
                  )}
                  {/\.gif$/i.test(p.file.name) || p.file.type === "image/gif" ? (
                    <span className="absolute bottom-2 left-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">
                      GIF
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => dropPending(new Set([p.key]))}
                    aria-label={`เอา ${p.file.name} ออก`}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                  >
                    <Icon name="x" className="size-3" />
                  </button>
                </span>
              ) : (
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
                    onClick={() => dropPending(new Set([p.key]))}
                    aria-label={`เอา ${p.file.name} ออก`}
                    className="relative shrink-0 text-faint hover:text-text"
                  >
                    <Icon name="x" className="size-3" />
                  </button>
                </span>
              ),
            )}
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
                // ปิดรายชื่อแท็กก่อน ไม่มีรายชื่อค้างแล้วค่อยยกเลิกการตอบกลับ
                if (mentionQuery !== null) setMentionQuery(null);
                else setReplying(null);
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

      {viewing && <Lightbox file={viewing} onClose={closeViewer} />}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-semibold text-accent">
          วางไฟล์เพื่อแนบ
        </div>
      )}
    </section>
  );
}
