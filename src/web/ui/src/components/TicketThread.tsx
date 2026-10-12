import { t } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { TicketThreadData } from "../lib/types";
import { Spinner } from "./ui";
import { useToast } from "./Toast";
import { Avatar } from "./Avatar";

/** ข้อความแอดมินยาวสุด — ต้องตรงกับ REPLY_MAX ใน src/web/routes/queue.ts */
const REPLY_MAX = 1500;

/**
 * บทสนทนาของ ticket — ตำรวจ (ซ้าย) คุยกับแอดมิน (ขวา) ผ่าน DM ของบอท
 *
 * ฝั่งตำรวจพิมพ์ใน DM ไม่ได้มาทางหน้าเว็บ เลยไม่มี push — โหลดใหม่ทุก 5 วิ ตอนเปิดอยู่เท่านั้น
 * (ปิดแผ่นแล้วคอมโพเนนต์หายไป การโหลดก็หยุดเอง)
 */
export function TicketThread({ id, onSent }: { id: number; onSent: () => void }) {
  const toast = useToast();
  const thread = useFetch<TicketThreadData>(`/api/tickets/${id}/messages`, 5_000);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = thread.data?.messages.length ?? 0;

  // มีข้อความใหม่ → เลื่อนไปข้อความล่าสุด (แบบแชททั่วไป)
  useEffect(() => {
    if (count) end.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api.post<{ ok: boolean; delivered: boolean; message: string }>(
        `/api/tickets/${id}/reply`,
        { body },
      );
      toast(r.message, r.delivered ? "ok" : "error");
      setText("");
      thread.reload();
      onSent();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("ส่งไม่สำเร็จ"), "error");
    } finally {
      setSending(false);
    }
  }

  if (!thread.data) {
    return (
      <div className="flex justify-center py-6 text-muted">
        {thread.error ? <p className="text-sm text-alert">{thread.error}</p> : <Spinner />}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-line bg-raised p-3">
      <ol className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
        {thread.data.messages.map((m) => {
          const mine = m.from === "admin";
          return (
            <li key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <span className={`mb-0.5 flex items-center gap-1.5 text-xs text-faint ${mine ? "flex-row-reverse" : ""}`}>
                <Avatar id={m.userId} name={m.name} size="xs" />
                {mine ? t("แอดมิน {name}", { name: m.name }) : t("ตำรวจ {name}", { name: m.name })} · {fmtDateTime(m.at)}
              </span>
              <p
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-sm ${
                  mine ? "border-accent/40 bg-accent-soft" : "border-line bg-surface"
                }`}
              >
                {m.body}
              </p>
              {m.attachments.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 max-w-[85%] truncate text-xs text-info underline"
                >
                  {t("ไฟล์แนบ")}
                </a>
              ))}
              {m.delivered === false && (
                <span className="mt-0.5 text-xs text-alert">{t("ส่ง DM ไม่ถึง — ตำรวจอาจปิด DM")}</span>
              )}
            </li>
          );
        })}
        <div ref={end} />
      </ol>

      {thread.data.open ? (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor={`reply-${id}`}>
            {t("ตอบตำรวจ")}
          </label>
          <textarea
            id={`reply-${id}`}
            rows={2}
            maxLength={REPLY_MAX}
            value={text}
            placeholder={t("พิมพ์ตอบ — บอทจะส่งทาง DM ให้ตำรวจ")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/⌘+Enter = ส่ง · Enter เฉย ๆ = ขึ้นบรรทัดใหม่ (ข้อความหลายบรรทัดเป็นเรื่องปกติ)
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
            className="min-w-0 flex-1 resize-y rounded-md border border-line bg-surface px-3 py-2 text-base outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="press min-h-10 shrink-0 rounded-md border border-accent bg-accent px-3.5 text-sm font-medium text-surface disabled:opacity-40"
          >
            {sending ? t("กำลังส่ง…") : t("ส่ง")}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-center text-xs text-faint">{t("ticket นี้ปิดแล้ว")}</p>
      )}
    </div>
  );
}
