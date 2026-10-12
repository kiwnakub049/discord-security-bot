import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { useToast } from "../components/Toast";
import { Button, Card, Empty, Spinner } from "../components/ui";
import { Icon } from "../components/Icon";

/**
 * หน้าแชทกับ Claude เรื่องเซิร์ฟ (mod + เจ้าของ)
 *
 * Claude อ่านข้อมูลได้เอง แต่ลงโทษไม่ได้ — ข้อเสนอขึ้นเป็นการ์ด ให้ผู้ดูแลกดยืนยัน
 * ปุ่มยืนยันเรียก /api/action/* ตัวเดียวกับแผ่นสมาชิก แล้วค่อยบันทึกผลกลับเข้าแชท
 */

interface Thread {
  id: number;
  title: string;
  updated_at: number;
}

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; label: string; detail: string | null }
  | {
      kind: "proposal";
      toolUseId: string;
      action: string;
      userId: string;
      userName: string | null;
      reason: string;
      minutes: number | null;
      status: "pending" | "done" | "dismissed";
      result: string | null;
    };
type Proposal = Extract<ChatItem, { kind: "proposal" }>;

// Claude อาจวนค้นข้อมูลหลายรอบ — รอได้นานกว่าคำขอปกติ (20 วิ)
const ASK_TIMEOUT_MS = 180_000;

const ACTION_LABEL: Record<string, string> = {
  warn: "เตือน",
  timeout: "timeout",
  untimeout: "ปลด timeout",
  kick: "เตะออก",
  ban: "แบน",
};
const DANGEROUS = new Set(["kick", "ban"]);

const SUGGESTIONS = [
  "สรุปเหตุการณ์ในเซิร์ฟ 24 ชั่วโมงที่ผ่านมา",
  "สัปดาห์นี้ใครโดนเตือนบ่อยที่สุด มีใครควรจับตาไหม",
  "มีอะไรค้างในคิวที่ควรจัดการก่อน",
  "AI mod จับผิดบ่อยไหม ควรปรับเกณฑ์ยังไง",
];

/** **ตัวหนา** อย่างเดียว — ไม่ใช้ innerHTML กันข้อความใน log แทรก HTML */
function renderInline(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-1 leading-relaxed">
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*[-•*]\s+/.exec(line);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-muted">•</span>
              <span className="min-w-0 break-words">{renderInline(line.slice(bullet[0].length))}</span>
            </div>
          );
        }
        return line.trim() ? (
          <p key={i} className="break-words">
            {renderInline(line)}
          </p>
        ) : (
          <div key={i} className="h-1.5" />
        );
      })}
    </div>
  );
}

function ProposalCard({
  item,
  threadId,
  onDecided,
}: {
  item: Proposal;
  threadId: number;
  onDecided: (status: "done" | "dismissed", result: string | null) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const label = ACTION_LABEL[item.action] ?? item.action;
  const dangerous = DANGEROUS.has(item.action);
  const what = item.action === "timeout" && item.minutes ? `${label} ${item.minutes} นาที` : label;

  async function record(status: "done" | "dismissed", result: string | null) {
    await api.post(`/api/chat/threads/${threadId}/actions/${encodeURIComponent(item.toolUseId)}`, { status, result });
    onDecided(status, result);
  }

  async function confirm() {
    if (dangerous && !armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; message: string }>(`/api/action/${item.action}`, {
        userId: item.userId,
        reason: item.reason,
        ...(item.action === "timeout" ? { minutes: item.minutes ?? 60 } : {}),
      });
      toast(r.message, r.ok ? "ok" : "error");
      if (r.ok) await record("done", r.message);
    } catch (e) {
      toast(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await record("dismissed", null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-md border p-3 ${dangerous ? "border-alert/40" : "border-line"} bg-surface`}>
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Icon name={dangerous ? "ban" : "warn"} className={`size-4 ${dangerous ? "text-alert" : "text-warn"}`} />
        Claude เสนอ: {what}
      </div>
      <div className="text-sm">
        {item.userName ?? "ไม่ทราบชื่อ"} <span className="text-muted">({item.userId})</span>
      </div>
      <div className="mt-1 text-sm text-muted">เหตุผล: {item.reason}</div>
      {item.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button variant={dangerous ? "danger" : "accent"} disabled={busy} onClick={() => void confirm()}>
            {busy ? <Spinner className="size-4" /> : null}
            {armed ? `กดอีกครั้งเพื่อ${label}` : `ยืนยัน${label}`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void dismiss()}>
            ไม่ทำ
          </Button>
        </div>
      ) : (
        <div className={`mt-2 text-sm ${item.status === "done" ? "text-ok" : "text-muted"}`}>
          {item.status === "done" ? `✓ ทำแล้ว${item.result ? ` — ${item.result}` : ""}` : "ไม่ได้ทำ"}
        </div>
      )}
    </div>
  );
}

export function Assistant() {
  const toast = useToast();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const loadThreads = () =>
    api
      .get<{ threads: Thread[] }>("/api/chat/threads")
      .then((r) => setThreads(r.threads))
      .catch(() => {});

  useEffect(() => {
    void loadThreads();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, sending]);

  async function open(id: number) {
    if (sending) return;
    setActiveId(id);
    setLoading(true);
    try {
      const r = await api.get<{ items: ChatItem[] }>(`/api/chat/threads/${id}`);
      setItems(r.items);
    } catch (e) {
      toast(e instanceof Error ? e.message : "เปิดแชทไม่ได้", "error");
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    if (sending) return;
    setActiveId(null);
    setItems([]);
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    setSending(t);
    setInput("");
    try {
      const r =
        activeId === null
          ? await api.post<{ thread: Thread; items: ChatItem[] }>("/api/chat/threads", { text: t }, ASK_TIMEOUT_MS)
          : await api.post<{ thread: Thread; items: ChatItem[] }>(
              `/api/chat/threads/${activeId}/messages`,
              { text: t },
              ASK_TIMEOUT_MS,
            );
      setActiveId(r.thread.id);
      setItems(r.items);
      void loadThreads();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ส่งไม่สำเร็จ", "error");
      setInput(t); // คืนข้อความให้กดส่งใหม่ได้ ไม่ต้องพิมพ์ซ้ำ
      if (e instanceof ApiError && e.status === 0 && activeId !== null) void open(activeId);
    } finally {
      setSending(null);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("ลบแชทนี้?")) return;
    try {
      await api.del(`/api/chat/threads/${id}`);
      if (activeId === id) startNew();
      void loadThreads();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ลบไม่สำเร็จ", "error");
    }
  }

  const decide = (toolUseId: string) => (status: "done" | "dismissed", result: string | null) =>
    setItems((xs) => xs.map((x) => (x.kind === "proposal" && x.toolUseId === toolUseId ? { ...x, status, result } : x)));

  return (
    <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
      {/* ---- รายการแชท ---- */}
      <Card className="h-fit p-2">
        <Button full variant="accent" disabled={!!sending} onClick={startNew}>
          <Icon name="message" className="size-4" />
          แชทใหม่
        </Button>
        <div className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto md:max-h-[60vh]">
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center rounded-md ${activeId === t.id ? "bg-raised" : "hover:bg-raised"}`}
            >
              <button
                type="button"
                onClick={() => void open(t.id)}
                className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm"
                title={t.title}
              >
                {t.title}
              </button>
              <button
                type="button"
                onClick={() => void remove(t.id)}
                className="px-2 text-muted opacity-60 hover:text-alert group-hover:opacity-100"
                aria-label="ลบแชท"
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          ))}
          {threads.length === 0 && <div className="px-2.5 py-2 text-sm text-muted">ยังไม่มีแชท</div>}
        </div>
      </Card>

      {/* ---- บทสนทนา ---- */}
      <Card className="flex min-h-[60vh] flex-col p-3">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : items.length === 0 && !sending ? (
            <div className="py-6">
              <Empty icon="bot">ถาม Claude เรื่องเซิร์ฟได้เลย — ดึงข้อมูล log, สมาชิก, คิว และเสนอการลงโทษให้กดยืนยัน</Empty>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="press rounded-md border border-line bg-surface px-3 py-2.5 text-left text-sm hover:bg-raised"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            items.map((it, i) =>
              it.kind === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-md bg-accent px-3 py-2 text-sm text-surface">
                    <RichText text={it.text} />
                  </div>
                </div>
              ) : it.kind === "assistant" ? (
                <div key={i} className="max-w-[92%] text-sm">
                  <RichText text={it.text} />
                </div>
              ) : it.kind === "tool" ? (
                <div key={i} className="flex items-center gap-1.5 text-xs text-muted">
                  <Icon name="search" className="size-3.5" />
                  {it.label}
                  {it.detail ? `: ${it.detail}` : ""}
                </div>
              ) : (
                <div key={i} className="max-w-[92%]">
                  <ProposalCard item={it} threadId={activeId ?? 0} onDecided={decide(it.toolUseId)} />
                </div>
              ),
            )
          )}
          {sending && (
            <>
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-md bg-accent px-3 py-2 text-sm text-surface opacity-70">
                  <RichText text={sending} />
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner className="size-4" />
                Claude กำลังค้นข้อมูลและคิด…
              </div>
            </>
          )}
          <div ref={bottom} />
        </div>

        <form
          className="mt-3 flex items-end gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่ (ไม่ส่งตอนกำลังพิมพ์ภาษาไทยด้วย IME)
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="ถามเรื่องเซิร์ฟ… (Enter ส่ง, Shift+Enter ขึ้นบรรทัด)"
            className="min-h-10 flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <Button type="submit" variant="accent" disabled={!!sending || !input.trim()}>
            <Icon name="chevron" className="size-4" />
            ส่ง
          </Button>
        </form>
      </Card>
    </div>
  );
}
