import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadMod } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { Badge, Button, Card, Empty, Meter, SectionTitle, Spinner } from "../components/ui";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { fmtDuration, fmtMb } from "../lib/format";

/**
 * แผงคุมเซิร์ฟเวอร์ BeamNG (BeamMP) — เห็นเฉพาะเจ้าของเครื่อง
 *
 * หน้านี้ไม่ได้แตะเซิร์ฟเกมเอง ทุกอย่างวิ่งผ่าน /api/beammp ซึ่งส่งต่อไปหา agent
 * ที่ 127.0.0.1 อีกทีหนึ่ง (ดูเหตุผลใน src/beammp/supervisor.ts)
 */

type State = "stopped" | "starting" | "running" | "stopping";

interface Player {
  id: number;
  name: string;
  guest: boolean;
  cars: number;
}

interface Status {
  state: State;
  pid: number | null;
  startedAt: number | null;
  lastExit: { code: number | null; signal: string | null; at: number } | null;
  hasAuthKey: boolean;
  binaryExists: boolean;
  players: { count: number; players: Player[]; stale: boolean } | null;
  port: number;
  addresses: { kind: "lan" | "tailscale"; host: string; label: string }[];
  error?: string;
}

const STATE_LOOK: Record<State, { label: string; tone: "ok" | "warn" | "plain" }> = {
  running: { label: "กำลังทำงาน", tone: "ok" },
  starting: { label: "กำลังเปิด", tone: "warn" },
  stopping: { label: "กำลังปิด", tone: "warn" },
  stopped: { label: "หยุดอยู่", tone: "plain" },
};

export function BeamNG() {
  const status = useFetch<Status>("/api/beammp/status", 4000);
  const [tab, setTab] = useState<"control" | "config" | "mods">("control");

  if (status.loading && !status.data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    );
  }

  const s = status.data;
  // agent ล่ม = ทุกอย่างในหน้านี้ทำอะไรไม่ได้ บอกให้จบตรงนี้เลย ไม่ต้องโชว์แท็บให้กดแล้วพัง
  if (!s || status.error) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Icon name="warn" className="mt-0.5 size-5 shrink-0 text-alert" />
          <div className="min-w-0">
            <p className="text-sm font-medium">ต่อ agent ไม่ได้</p>
            <p className="mt-1 text-xs text-muted">
              {status.error ?? "ไม่ทราบสาเหตุ"}
            </p>
            <p className="mt-2 text-xs text-faint">
              เช็คบนเครื่อง:{" "}
              <code className="rounded bg-raised px-1">
                systemctl status beammp-agent
              </code>
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <StatusCard s={s} onChanged={status.reload} />

      <div className="flex gap-1 rounded-md bg-raised p-1">
        {(
          [
            ["control", "คอนโซล", "terminal"],
            ["config", "ตั้งค่า", "settings"],
            ["mods", "ม็อด", "download"],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`press flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition ${
              tab === key ? "bg-surface text-text shadow-sm" : "text-muted"
            }`}
          >
            <Icon name={icon} className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "control" && <LogPanel />}
      {tab === "config" && <ConfigPanel running={s.state === "running"} />}
      {tab === "mods" && <ModsPanel running={s.state === "running"} />}
    </div>
  );
}

/* ─────────── สถานะ + ปุ่มเปิด/ปิด ─────────── */

function StatusCard({ s, onChanged }: { s: Status; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const look = STATE_LOOK[s.state];
  const running = s.state === "running";

  const act = async (action: "start" | "stop" | "restart", label: string) => {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(
        `/api/beammp/${action}`,
      );
      if (r.ok) toast(`${label}เซิร์ฟเวอร์แล้ว`, "ok");
      else toast(r.error ?? `${label}ไม่สำเร็จ`, "error");
    } catch (err) {
      toast(err instanceof Error ? err.message : `${label}ไม่สำเร็จ`, "error");
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Card level="glass" className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`relative flex size-2.5 ${running ? "" : "opacity-50"}`}
          aria-hidden="true"
        >
          {running && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
          )}
          <span
            className={`relative inline-flex size-2.5 rounded-full ${running ? "bg-ok" : "bg-faint"}`}
          />
        </span>
        <span className="text-sm font-medium">{look.label}</span>
        <Badge tone={look.tone}>{running ? `PID ${s.pid}` : "ไม่ได้รัน"}</Badge>
        {running && s.startedAt && (
          <Badge tone="plain">
            <Icon name="clock" className="size-3" />
            {fmtDuration((Date.now() - s.startedAt) / 1000)}
          </Badge>
        )}
      </div>

      {/* เตือนสาเหตุที่ทำให้เปิดไม่ขึ้น ก่อนที่ผู้ใช้จะกดปุ่มแล้วงงว่าทำไมไม่ติด */}
      {!s.binaryExists && (
        <Warn>ไม่พบไฟล์ BeamMP-Server ในโฟลเดอร์เกม</Warn>
      )}
      {s.binaryExists && !s.hasAuthKey && (
        <Warn>
          ยังไม่ได้ใส่ AuthKey — ขอได้ที่ keymaster.beammp.com แล้วใส่ในไฟล์
          ServerConfig.toml บนเครื่อง (ไม่ให้แก้จากหน้าเว็บเพราะเป็นคีย์ลับ)
        </Warn>
      )}
      {!running && s.lastExit && s.lastExit.code !== 0 && s.lastExit.code !== null && (
        <Warn>
          รอบที่แล้วจบด้วยรหัส {s.lastExit.code} — ดูสาเหตุได้ในแท็บคอนโซล
        </Warn>
      )}

      <div className="mt-3 flex gap-2">
        {running ? (
          <>
            <Button variant="danger" onClick={() => act("stop", "ปิด")} disabled={busy}>
              <Icon name="square" className="size-4" />
              ปิด
            </Button>
            <Button onClick={() => act("restart", "รีสตาร์ท")} disabled={busy}>
              <Icon name="refresh" className="size-4" />
              รีสตาร์ท
            </Button>
          </>
        ) : (
          <Button
            variant="accent"
            onClick={() => act("start", "เปิด")}
            disabled={busy || !s.binaryExists || !s.hasAuthKey}
          >
            <Icon name="play" className="size-4" />
            เปิดเซิร์ฟเวอร์
          </Button>
        )}
        {busy && <Spinner className="size-5 self-center text-muted" />}
      </div>

      {running && <JoinInfo s={s} />}
      {running && <Players data={s.players} />}
    </Card>
  );
}

/** ที่อยู่สำหรับเข้าเล่น พร้อมปุ่มคัดลอก — เลขนี้คนต้องเอาไปพิมพ์ในเกม */
function JoinInfo({ s }: { s: Status }) {
  const toast = useToast();
  if (s.addresses.length === 0) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-xs text-muted">เข้าเล่นที่ (Multiplayer → Direct Connect)</p>
      <div className="space-y-1.5">
        {s.addresses.map((a) => {
          const full = `${a.host}:${s.port}`;
          return (
            <button
              key={a.host}
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(full).then(
                  () => toast(`คัดลอก ${full} แล้ว`, "ok"),
                  () => toast("คัดลอกไม่สำเร็จ", "error"),
                );
              }}
              className="press flex w-full items-center gap-2 rounded-md bg-raised px-3 py-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-faint">{a.label}</span>
                <span className="tnum block font-mono text-sm">{full}</span>
              </span>
              <Icon name="download" className="size-4 shrink-0 rotate-180 text-faint" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md bg-warn-soft p-2.5 text-xs text-warn">
      <Icon name="warn" className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Players({ data }: { data: Status["players"] }) {
  if (!data) {
    return (
      <p className="mt-3 border-t border-line pt-3 text-xs text-faint">
        กำลังรอข้อมูลผู้เล่นจากเซิร์ฟเวอร์…
      </p>
    );
  }
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <Icon name="users" className="size-4" />
        ผู้เล่นออนไลน์ {data.count} คน
        {/*
          ปลั๊กอินเขียนสถานะทุก 2 วินาที ถ้าไฟล์ค้างเกิน 15 วิ แปลว่าปลั๊กอินไม่ทำงาน
          บอกตรง ๆ ดีกว่าโชว์เลข 0 ให้เข้าใจผิดว่าไม่มีใครเล่น
        */}
        {data.stale && <Badge tone="warn">ข้อมูลค้าง</Badge>}
      </div>
      {data.players.length === 0 ? (
        <p className="text-xs text-faint">ยังไม่มีใครเข้ามา</p>
      ) : (
        <ul className="space-y-1">
          {data.players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <Icon name="user" className="size-4 text-faint" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.guest && <Badge tone="plain">guest</Badge>}
              <Badge tone="plain">
                <Icon name="car" className="size-3" />
                {p.cars}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────── คอนโซล (log สด) ─────────── */

interface LogLine {
  at: number;
  text: string;
}

function LogPanel() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [live, setLive] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  /*
   * เลื่อนตามบรรทัดใหม่เฉพาะตอนผู้ใช้อยู่ล่างสุดอยู่แล้ว
   * ถ้าเขากำลังเลื่อนขึ้นไปอ่านของเก่า แล้วเราลากกลับลงมาทุก 2 วิ จะอ่านอะไรไม่ได้เลย
   */
  const stick = useRef(true);

  useEffect(() => {
    const es = new EventSource("/api/beammp/logs/stream");
    es.addEventListener("open", () => setLive(true));
    es.addEventListener("hello", (e) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as { lines: LogLine[] };
      setLines(d.lines);
      setLive(true);
    });
    es.addEventListener("log", (e) => {
      const line = JSON.parse((e as MessageEvent<string>).data) as LogLine;
      // เก็บไม่เกิน 500 บรรทัดในหน้า — เซิร์ฟเกมพ่น log เร็วมากตอนมีคนเล่นเยอะ
      setLines((prev) => [...prev, line].slice(-500));
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  useEffect(() => {
    if (stick.current && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines]);

  const onScroll = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  return (
    <Card className="overflow-hidden">
      <SectionTitle
        action={
          <Badge tone={live ? "ok" : "warn"}>{live ? "สด" : "หลุด"}</Badge>
        }
      >
        คอนโซลเซิร์ฟเวอร์
      </SectionTitle>
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="max-h-[60vh] min-h-[240px] overflow-y-auto bg-raised px-3 py-2 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="py-8 text-center text-faint">ยังไม่มี log</p>
        ) : (
          lines.map((l, i) => (
            <div key={`${l.at}-${i}`} className="whitespace-pre-wrap break-all">
              {l.text}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/* ─────────── ตั้งค่า ─────────── */

interface FieldSpec {
  section: string;
  type: "string" | "int" | "bool" | "map";
  label: string;
  min?: number;
  max?: number;
  multiline?: boolean;
}

interface ConfigData {
  values: Record<string, string | number | boolean>;
  fields: Record<string, FieldSpec>;
  maps: { value: string; label: string }[];
}

function ConfigPanel({ running }: { running: boolean }) {
  const cfg = useFetch<ConfigData>("/api/beammp/config");
  // แผนที่จากม็อดที่อัปโหลดไว้ — สแกนจากในไฟล์ zip ไม่ได้ให้พิมพ์ path เอง
  const custom = useFetch<{ levels: { value: string; from: string }[] }>(
    "/api/beammp/levels",
  );
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cfg.data) setDraft(cfg.data.values);
  }, [cfg.data]);

  if (cfg.loading && !cfg.data) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (!cfg.data) return <Empty icon="warn">โหลดค่าตั้งไม่ได้</Empty>;

  const dirty = Object.keys(draft).filter(
    (k) => draft[k] !== cfg.data!.values[k],
  );

  const save = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of dirty) patch[k] = draft[k];
      const r = await api.put<{ needsRestart?: boolean }>(
        "/api/beammp/config",
        patch,
      );
      toast(
        r.needsRestart
          ? "บันทึกแล้ว — ต้องรีสตาร์ทเซิร์ฟเวอร์ถึงจะมีผล"
          : "บันทึกแล้ว",
        "ok",
      );
      cfg.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string, v: string | number | boolean) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Card className="overflow-hidden">
      <SectionTitle>ตั้งค่าเซิร์ฟเวอร์</SectionTitle>
      <div className="space-y-4 p-4">
        {Object.entries(cfg.data.fields).map(([key, spec]) => {
          const v = draft[key];
          return (
            <div key={key}>
              <label
                htmlFor={`f-${key}`}
                className="mb-1 block text-xs font-medium text-muted"
              >
                {spec.label}
              </label>

              {spec.type === "bool" && (
                <button
                  id={`f-${key}`}
                  type="button"
                  role="switch"
                  aria-checked={v === true}
                  onClick={() => set(key, !v)}
                  className={`press relative h-7 w-12 rounded-full transition ${
                    v ? "bg-accent" : "bg-raised"
                  }`}
                >
                  <span
                    className={`absolute top-1 size-5 rounded-full bg-surface shadow transition-all ${
                      v ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              )}

              {spec.type === "map" && (
                <MapPicker
                  id={`f-${key}`}
                  value={String(v ?? "")}
                  builtin={cfg.data!.maps}
                  custom={custom.data?.levels ?? []}
                  onChange={(next) => set(key, next)}
                />
              )}

              {spec.type === "int" && (
                <input
                  id={`f-${key}`}
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  value={Number(v ?? 0)}
                  onChange={(e) => set(key, Number(e.target.value))}
                  className="w-32 rounded-md border border-line bg-surface px-3 py-2 text-sm tnum"
                />
              )}

              {spec.type === "string" &&
                (spec.multiline ? (
                  <textarea
                    id={`f-${key}`}
                    rows={2}
                    value={String(v ?? "")}
                    onChange={(e) => set(key, e.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
                  />
                ) : (
                  <input
                    id={`f-${key}`}
                    type="text"
                    value={String(v ?? "")}
                    onChange={(e) => set(key, e.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
                  />
                ))}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-raised px-4 py-3">
        <Button variant="accent" onClick={save} disabled={dirty.length === 0 || saving}>
          <Icon name="check" className="size-4" />
          บันทึก{dirty.length > 0 ? ` (${dirty.length})` : ""}
        </Button>
        {dirty.length > 0 && running && (
          <span className="text-xs text-warn">ต้องรีสตาร์ทถึงจะมีผล</span>
        )}
      </div>
    </Card>
  );
}

/**
 * ตัวเลือกแผนที่ — รวมแผนที่ที่มากับเกม + แผนที่จากม็อดที่อัปโหลดไว้ + พิมพ์เองได้
 *
 * ที่ต้องมีช่องพิมพ์เอง เพราะม็อดบางตัวใส่แผนที่ไว้ในไฟล์ zip ซ้อนอีกชั้น
 * ซึ่งการสแกนสารบัญ zip ชั้นเดียวมองไม่เห็น ถ้าไม่มีทางพิมพ์เองจะติดตาย
 */
function MapPicker({
  id,
  value,
  builtin,
  custom,
  onChange,
}: {
  id: string;
  value: string;
  builtin: { value: string; label: string }[];
  custom: { value: string; from: string }[];
  onChange: (v: string) => void;
}) {
  const CUSTOM = "__custom__";
  const known = [...builtin.map((m) => m.value), ...custom.map((c) => c.value)];
  const [manual, setManual] = useState(value !== "" && !known.includes(value));

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={manual ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) setManual(true);
          else {
            setManual(false);
            onChange(e.target.value);
          }
        }}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
      >
        <optgroup label="มากับเกม">
          {builtin.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </optgroup>
        {custom.length > 0 && (
          <optgroup label="จากม็อดที่อัปโหลด">
            {custom.map((c) => (
              <option key={c.value} value={c.value}>
                {/\/levels\/([^/]+)\//.exec(c.value)?.[1] ?? c.value} — {c.from}
              </option>
            ))}
          </optgroup>
        )}
        <option value={CUSTOM}>พิมพ์เอง…</option>
      </select>

      {manual && (
        <div>
          <input
            type="text"
            value={value}
            placeholder="/levels/ชื่อแผนที่/info.json"
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-[11px] text-faint">
            ชื่อแผนที่ดูได้จากในไฟล์ม็อด โฟลเดอร์ levels/&lt;ชื่อ&gt;/
          </p>
        </div>
      )}
    </div>
  );
}

/* ─────────── ม็อด ─────────── */

interface ModsData {
  mods: { name: string; size: number; at: number; levels?: string[] }[];
  maxBytes: number;
}

function ModsPanel({ running }: { running: boolean }) {
  const mods = useFetch<ModsData>("/api/beammp/mods");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // null = ไม่ได้อัปโหลดอยู่ | 0..1 = ความคืบหน้า
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    /*
     * เช็คขนาดตั้งแต่ก่อนเริ่มส่ง — ไม่มีเหตุผลให้ผู้ใช้รออัป 1.5GB ผ่าน Wi-Fi
     * จนเสร็จแล้วค่อยบอกว่าใหญ่เกิน (เซิร์ฟเวอร์ก็ยังกันซ้ำอีกชั้นอยู่ดี)
     */
    const max = mods.data?.maxBytes ?? 0;
    if (max > 0 && file.size > max) {
      toast(`ไฟล์ใหญ่เกิน ${fmtMb(max / 1024 / 1024)}`, "error");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const r = await uploadMod(file, setProgress);
      /*
       * บอกไปเลยว่าม็อดนี้มีแผนที่อะไรบ้าง — ไม่งั้นผู้ใช้ต้องเดาเองว่าจะเลือกอะไร
       * ในช่องแผนที่ ซึ่งเป็นเหตุผลอันดับหนึ่งที่ตั้งค่าแผนที่แล้วเซิร์ฟขึ้นไม่ได้
       */
      const lv = r.levels ?? [];
      toast(
        lv.length > 0
          ? `อัปโหลดแล้ว — มีแผนที่ ${lv.length} อัน เลือกได้ในแท็บตั้งค่า`
          : running
            ? "อัปโหลดแล้ว — รีสตาร์ทเพื่อให้ผู้เล่นได้รับ"
            : "อัปโหลดแล้ว",
        "ok",
      );
      mods.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`ลบ "${name}" ?`)) return;
    try {
      await api.del(`/api/beammp/mods?name=${encodeURIComponent(name)}`);
      toast("ลบแล้ว", "ok");
      mods.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "ลบไม่สำเร็จ", "error");
    }
  };

  return (
    <Card className="overflow-hidden">
      <SectionTitle>ม็อดฝั่งผู้เล่น</SectionTitle>
      <div className="p-4">
        <p className="mb-3 text-xs text-muted">
          ไฟล์ .zip ในนี้จะถูกส่งให้ทุกคนตอนเข้าเซิร์ฟเวอร์ — สูงสุด{" "}
          {fmtMb((mods.data?.maxBytes ?? 0) / 1024 / 1024)} ต่อไฟล์
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button
          variant="accent"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Spinner className="size-4" /> : <Icon name="upload" className="size-4" />}
          {busy ? "กำลังอัปโหลด…" : "เพิ่มม็อด"}
        </Button>

        {/* ไฟล์ 1GB ใช้เวลาเป็นนาที ต้องมีตัวเลขบอก ไม่งั้นดูเหมือนค้าง */}
        {progress !== null && (
          <div className="mt-3">
            <Meter pct={progress * 100} />
            <p className="tnum mt-1 text-[11px] text-faint">
              {Math.round(progress * 100)}%
              {progress >= 1 && " — กำลังตรวจไฟล์…"}
            </p>
          </div>
        )}

        <div className="mt-4">
          {mods.loading && !mods.data ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : !mods.data || mods.data.mods.length === 0 ? (
            <Empty icon="download">ยังไม่มีม็อด</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {mods.data.mods.map((m) => (
                <li key={m.name} className="flex items-center gap-3 py-2.5">
                  <Icon name="download" className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{m.name}</span>
                    {m.levels && m.levels.length > 0 && (
                      <span className="block truncate text-[11px] text-accent">
                        แผนที่:{" "}
                        {m.levels
                          .map((l) => /\/levels\/([^/]+)\//.exec(l)?.[1] ?? l)
                          .join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="tnum shrink-0 text-xs text-faint">
                    {fmtMb(m.size / 1024 / 1024)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(m.name)}
                    aria-label={`ลบ ${m.name}`}
                    className="press shrink-0 rounded-lg p-1.5 text-muted hover:text-alert"
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
