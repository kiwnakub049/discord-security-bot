import { useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { api } from "../lib/api";
import { fmtDuration } from "../lib/format";
import type { ActionResult, MuteEntry } from "../lib/types";
import { Icon } from "./Icon";
import { Button, Card, SectionTitle } from "./ui";
import { useToast } from "./Toast";
import { Avatar } from "./Avatar";

/**
 * ไมค์แดงจากระบบเตือน — ใครโดนอยู่ เหลืออีกนานแค่ไหน และปุ่มปลดทันที
 *
 * ปุ่มนี้คือทางเดียวที่ปลดก่อนเวลาได้จริง: กดปลดใน Discord เอง บอทจะปิดกลับทันที
 * เพราะโทษยังไม่หมดเวลา (ดู muteEnforce) — ไม่มีใครโดนอยู่ = ไม่วาดส่วนนี้เลย
 */
export function MuteList() {
  const toast = useToast();
  const q = useFetch<{ mutes: MuteEntry[] }>("/api/mutes", 15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const mutes = q.data?.mutes ?? [];
  if (!mutes.length) return null;
  const now = Date.now();

  async function release(m: MuteEntry) {
    setBusy(m.userId);
    try {
      const r = await api.post<ActionResult>("/api/action/unmute", { userId: m.userId });
      toast(r.message, r.ok ? "ok" : "error");
      q.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ปลดไม่สำเร็จ", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <SectionTitle>ไมค์แดงจากระบบเตือน</SectionTitle>
      <Card className="divide-y divide-line">
        {mutes.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
            {/* รูปคน + ไอคอนไมค์แดงเกาะมุม — เห็นทั้งว่าใครและว่าโดนอะไร */}
            <span className="relative shrink-0">
              <Avatar id={m.userId} name={m.name} size="md" />
              <span className="absolute -bottom-1 -right-1 rounded-full bg-surface p-0.5">
                <Icon name="mic-off" className="size-3.5 text-alert" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.name}</div>
              <div className="text-xs text-muted">
                {m.pending || m.until == null
                  ? "ครบเวลาแล้ว — ปลดให้ตอนกลับเข้าห้องเสียง"
                  : `ปลดเองในอีก ${fmtDuration(Math.max(0, (m.until - now) / 1000))}`}
                {" · "}
                {m.inVoice ? "อยู่ในห้องเสียง" : "ไม่อยู่ในห้องเสียง"}
                {m.reason && ` · ${m.reason}`}
              </div>
            </div>
            <Button disabled={busy === m.userId} onClick={() => void release(m)}>
              <Icon name="unlock" className="size-4" />
              ปลดทันที
            </Button>
          </div>
        ))}
      </Card>
    </section>
  );
}
