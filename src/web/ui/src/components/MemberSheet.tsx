import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ActionResult, Member, RankEntry, Warning } from "../lib/types";
import { fmtDateTime, fmtDuration, fmtNum } from "../lib/format";
import { Badge, Button, Meter, Spinner } from "./ui";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

const TIMEOUTS = [10, 60, 24 * 60] as const;

/** รายละเอียดสมาชิก + ปุ่มสั่งงานของ mod */
export function MemberSheet({
  member,
  onClose,
  onChanged,
}: {
  member: Member | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const [activity, setActivity] = useState<RankEntry | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"kick" | "ban" | null>(null);

  useEffect(() => {
    setWarnings(null);
    setActivity(null);
    setReason("");
    setConfirming(null);
    if (!member) return;
    const id = member.id;
    api
      .get<Warning[]>(`/api/members/${id}/warnings`)
      .then(setWarnings)
      .catch(() => setWarnings([]));
    api
      .get<RankEntry>(`/api/activity/${id}`)
      .then(setActivity)
      .catch(() => {
        /* ไม่มีข้อมูลความเคลื่อนไหว — แถบเลเวลจะไม่ขึ้น เท่านั้นเอง */
      });
  }, [member]);

  if (!member) return null;

  async function run(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api.post<ActionResult>(path, body);
      toast(r.message, r.ok ? "ok" : "error");
      if (r.ok) {
        onChanged();
        onClose();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const payload = () => ({
    userId: member.id,
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  });

  return (
    <Sheet open title={member.username} onClose={onClose}>
      <div className="space-y-5">
        {/* ---- บัตรประจำตัว ---- */}
        <img
          src={`/api/members/${member.id}/card.png`}
          alt={`บัตรของ ${member.username}`}
          loading="lazy"
          className="w-full rounded-xl border border-line bg-raised"
        />

        {/* ---- ข้อมูลย่อ ---- */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
          <Info label="เลขสมาชิก" value={`#${member.member_number}`} />
          <Info label="เข้าร่วม" value={member.join_date} />
          <Info label="ไบแอส" value={member.bias || "-"} />
          <Info label="สถานะ" value={member.status || "-"} />
        </div>

        {/* ---- เลเวล ---- */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium">เลเวล {member.level}</span>
            <span className="tnum text-xs text-muted">
              {activity
                ? `${fmtNum(activity.xpIntoLevel)} / ${fmtNum(activity.xpForNext)} XP`
                : `${fmtNum(member.xp)} XP`}
            </span>
          </div>
          <Meter pct={activity?.pct ?? 0} tone="accent" />
          {activity && (
            <div className="mt-1.5 flex gap-4 text-xs text-faint">
              <span>{fmtNum(activity.messages)} ข้อความ</span>
              <span>ห้องเสียง {fmtDuration(activity.voiceSeconds)}</span>
            </div>
          )}
        </div>

        {member.voice && (
          <div className="flex items-center gap-2 rounded-xl bg-info-soft px-3 py-2.5 text-sm text-info">
            <Icon name="volume" className="size-4 shrink-0" />
            อยู่ใน {member.voice.channelName}
          </div>
        )}

        {/* ---- ประวัติการเตือน ---- */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted">
              ประวัติการเตือน
              {warnings && warnings.length > 0 && ` (${warnings.length})`}
            </h3>
            {warnings && warnings.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("/api/action/clearwarnings", { userId: member.id })}
                className="text-xs font-medium text-accent disabled:opacity-40"
              >
                ล้างทั้งหมด
              </button>
            )}
          </div>
          {warnings === null ? (
            <div className="flex justify-center py-3 text-muted">
              <Spinner className="size-4" />
            </div>
          ) : warnings.length === 0 ? (
            <p className="text-sm text-faint">ยังไม่เคยถูกเตือน</p>
          ) : (
            <ul className="space-y-1.5">
              {warnings.map((w) => (
                <li key={w.id} className="rounded-lg bg-raised px-3 py-2 text-xs">
                  <div className="text-text">{w.reason}</div>
                  <div className="mt-0.5 text-faint">
                    {w.moderatorTag} · {fmtDateTime(w.timestamp)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- สั่งงาน ---- */}
        <div className="space-y-2.5 border-t border-line pt-4">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เหตุผล (ไม่ใส่ก็ได้)"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base outline-none placeholder:text-faint focus:border-accent"
          />

          <Button
            full
            variant="accent"
            disabled={busy}
            onClick={() => void run("/api/action/warn", payload())}
          >
            <Icon name="warn" className="size-4" />
            เตือน
          </Button>

          <div className="grid grid-cols-3 gap-2">
            {TIMEOUTS.map((m) => (
              <Button
                key={m}
                disabled={busy}
                onClick={() => void run("/api/action/timeout", { ...payload(), minutes: m })}
              >
                {m >= 60 ? `${m / 60} ชม.` : `${m} นาที`}
              </Button>
            ))}
          </div>

          <Button
            full
            disabled={busy}
            onClick={() => void run("/api/action/untimeout", payload())}
          >
            <Icon name="unlock" className="size-4" />
            ปลด timeout
          </Button>

          {/*
            เตะกับแบนต้องกดสองที — ปุ่มพวกนี้อยู่ใกล้ปุ่มอื่นบนจอมือถือ
            การกดพลาดครั้งเดียวแล้วคนโดนแบนทันทีเป็นความเสียหายที่ย้อนคืนยาก
          */}
          <div className="grid grid-cols-2 gap-2">
            {(["kick", "ban"] as const).map((act) => (
              <Button
                key={act}
                variant="danger"
                disabled={busy}
                onClick={() =>
                  confirming === act
                    ? void run(`/api/action/${act}`, payload())
                    : setConfirming(act)
                }
              >
                <Icon name={act === "ban" ? "ban" : "logout"} className="size-4" />
                {confirming === act
                  ? "กดอีกครั้งเพื่อยืนยัน"
                  : act === "ban"
                    ? "แบน"
                    : "เตะออก"}
              </Button>
            ))}
          </div>

          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="w-full py-1 text-center text-xs text-muted"
            >
              ยกเลิก
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-faint">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

/** ป้ายสถานะเสียงเล็ก ๆ ที่ใช้ทั้งในรายการและในแผ่นรายละเอียด */
export function VoiceBadges({ member }: { member: Member }) {
  if (!member.voice) return null;
  const { selfMute, serverMute, selfDeaf, serverDeaf } = member.voice;
  return (
    <div className="flex items-center gap-1">
      <Badge tone="info">
        <Icon name="volume" className="size-3" />
        {member.voice.channelName}
      </Badge>
      {(selfMute || serverMute) && (
        <Badge tone="warn">
          <Icon name="mic-off" className="size-3" />
        </Badge>
      )}
      {(selfDeaf || serverDeaf) && (
        <Badge tone="warn">
          <Icon name="headphone-off" className="size-3" />
        </Badge>
      )}
    </div>
  );
}
