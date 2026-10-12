import { useState } from "react";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import type {
  ActionResult,
  DeviceSession,
  OledConfig,
  SettingItem,
  SettingSection,
} from "../lib/types";
import { fmtAgo } from "../lib/format";
import { Badge, Button, Card, Chip, SectionTitle, Spinner } from "../components/ui";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { setLinkTarget, useLinkTarget } from "../lib/linkTarget";
import { setSkin, useSkin } from "../lib/skin";
import { Avatar } from "../components/Avatar";

export function Settings({
  username,
  userId,
  seesSystem,
}: {
  username: string;
  userId: string;
  /** false = admin ที่ไม่ใช่เจ้าของ → ซ่อนตั้งค่าบอท/จอ OLED/รายชื่อคนเข้าได้ */
  seesSystem: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* ตั้งค่าบอท + รายชื่อคนที่เข้าได้ = mod กับเจ้าของ (admin ทั่วไปไม่เห็นหน้านี้เลย)
          ยศที่นับเป็น admin/mod แก้ได้แค่เจ้าของ — server ไม่ส่งหัวข้อนั้นมาให้คนอื่น */}
      {seesSystem && <BotSettings />}
      <ClaudeTest />
      <SkinPicker />
      <LinkTargetPicker />
      {seesSystem && <OledPicker />}
      <ServerLock />
      <Devices />
      {seesSystem && <AccessPeople me={username} />}
      <SignOut username={username} userId={userId} />
    </div>
  );
}

/* ---------------- หน้าตาบนจอคอม ---------------- */

/** ซ่อนบนมือถือ — หน้าตา macOS มีผลแค่จอกว้าง มือถือเป็นสมุดเวรเสมอ */
function SkinPicker() {
  const skin = useSkin();
  return (
    <section className="hidden md:block">
      <SectionTitle>หน้าตาบนจอคอม</SectionTitle>
      <Card className="p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="หน้าตาของเว็บ">
          <Chip active={skin === "duty"} onClick={() => setSkin("duty")}>
            สมุดเวรยาม
          </Chip>
          <Chip active={skin === "mac"} onClick={() => setSkin("mac")}>
            macOS
          </Chip>
        </div>
        <p className="mt-3 text-xs text-faint">
          ใช้เฉพาะจอกว้าง มือถือยังเป็นสมุดเวรยามเสมอ · ธีมสว่าง/มืดยังเลือกจากปุ่มบนหัวเว็บได้เหมือนเดิม
          · เก็บไว้ในเครื่องนี้เท่านั้น
        </p>
      </Card>
    </section>
  );
}

/* ---------------- ลิงก์ใน log เปิดที่ไหน ---------------- */

function LinkTargetPicker() {
  const target = useLinkTarget();

  return (
    <section>
      <SectionTitle>ลิงก์ใน log</SectionTitle>
      <Card className="p-4">
        <p className="mb-3 text-xs text-muted">
          กดชื่อห้องหรือ ID คนใน log แล้วให้เปิดที่ไหน
        </p>
        <div className="flex flex-wrap gap-2">
          <Chip active={target === "browser"} onClick={() => setLinkTarget("browser")}>
            เบราว์เซอร์
          </Chip>
          <Chip active={target === "app"} onClick={() => setLinkTarget("app")}>
            เด้งเข้าแอป Discord
          </Chip>
        </div>
        <p className="mt-3 text-xs text-faint">
          {target === "app"
            ? "เครื่องที่ไม่ได้ติดตั้งแอป Discord จะกดแล้วไม่เกิดอะไรขึ้น — สลับกลับเป็นเบราว์เซอร์ได้ตลอด"
            : "เปิดหน้าเว็บของ Discord ในแท็บใหม่ ใช้ได้ทุกเครื่องแม้ไม่ได้ติดตั้งแอป"}
        </p>
        <p className="mt-1.5 text-xs text-faint">
          ตั้งค่านี้เก็บไว้ในเครื่องนี้เท่านั้น ไม่ได้ใช้ร่วมกับ mod คนอื่น
        </p>
      </Card>
    </section>
  );
}

/* ---------------- อุปกรณ์ที่ login ค้างอยู่ ---------------- */

function Devices() {
  const toast = useToast();
  const { data, reload } = useFetch<DeviceSession[]>("/api/sessions");
  const [busy, setBusy] = useState(false);

  async function call(path: string, body?: unknown) {
    setBusy(true);
    try {
      const r = await api.post<ActionResult>(path, body);
      toast(r.message, r.ok ? "ok" : "error");
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
    }
  }

  const others = data?.filter((d) => !d.current).length ?? 0;

  return (
    <section>
      <SectionTitle>อุปกรณ์ที่เข้าสู่ระบบอยู่</SectionTitle>
      <Card className="divide-y divide-line">
        {data?.length === 0 && (
          <p className="p-4 text-sm text-faint">ยังไม่มีข้อมูล</p>
        )}
        {data?.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-4 py-3">
            <Icon
              name={d.device === "iPhone" || d.device === "Android" ? "user" : "monitor"}
              className="size-5 shrink-0 text-faint"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium">
                  {d.device} · {d.browser}
                </span>
                {d.current && <Badge tone="ok">เครื่องนี้</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-faint">
                ใช้ล่าสุด {fmtAgo(d.lastSeen)}
                {d.ip && ` · ${d.ip}`}
              </div>
            </div>
            {!d.current && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void call("/api/sessions/revoke", { id: d.id })}
                aria-label="เตะเครื่องนี้ออก"
                title="เตะเครื่องนี้ออก"
                className="press rounded-lg p-2 text-alert disabled:opacity-40"
              >
                <Icon name="x" className="size-4" />
              </button>
            )}
          </div>
        ))}

        <div className="space-y-2 p-4">
          <p className="text-xs text-muted">
            จำเครื่องไว้ 30 วันนับจากครั้งล่าสุดที่ใช้
          </p>
          {others > 0 && (
            <Button
              full
              variant="danger"
              disabled={busy}
              onClick={() => void call("/api/sessions/revoke-others")}
            >
              <Icon name="logout" className="size-4" />
              ออกจากระบบเครื่องอื่นทั้งหมด ({others})
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}

/* ---------------- ตั้งค่าบอท ---------------- */

function BotSettings() {
  const toast = useToast();
  const { data, loading, reload } = useFetch<SettingSection[]>("/api/settings");
  /** เก็บเฉพาะค่าที่ถูกแก้ — ส่งขึ้นไปแค่ส่วนที่เปลี่ยนจริง */
  const [dirty, setDirty] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);

  const count = Object.keys(dirty).length;

  async function save() {
    setSaving(true);
    try {
      const r = await api.post<ActionResult>("/api/settings", dirty);
      toast(r.message, "ok");
      setDirty({});
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <Card className="flex justify-center p-6 text-muted">
        <Spinner />
      </Card>
    );
  }

  return (
    <section>
      <SectionTitle>ตั้งค่าบอท</SectionTitle>
      <div className="stagger space-y-2">
        {data?.map((sec) => {
          const open = openSection === sec.section;
          const changed = sec.items.filter((i) => i.key in dirty).length;
          return (
            <Card key={sec.section} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenSection(open ? null : sec.section)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              >
                <span className="flex-1 text-sm font-medium">{sec.section}</span>
                {changed > 0 && (
                  <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                    แก้ {changed}
                  </span>
                )}
                <Icon
                  name="chevron"
                  className={`size-4 text-faint transition-transform ${open ? "rotate-90" : ""}`}
                />
              </button>
              {open && (
                <div className="space-y-4 border-t border-line px-4 py-4">
                  {sec.items.map((item) => (
                    <Field
                      key={item.key}
                      item={item}
                      override={dirty[item.key]}
                      onChange={(v) =>
                        setDirty((prev) => ({ ...prev, [item.key]: v }))
                      }
                    />
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/*
        แถบบันทึกลอยเหนือแถบแท็บล่าง — ถ้าฝังปุ่มไว้ท้ายรายการ ผู้ใช้ที่แก้ค่าหมวดบน
        แล้วเลื่อนดูหมวดอื่นต่อจะไม่รู้ว่ายังไม่ได้บันทึก
      */}
      {count > 0 && (
        <div className="glass-strong rise sticky bottom-24 z-20 mt-3 flex items-center gap-3 rounded-md !border-accent/40 px-4 py-3 md:bottom-4">
          <span className="flex-1 text-sm">แก้ไว้ {count} รายการ</span>
          <Button variant="ghost" onClick={() => setDirty({})} disabled={saving}>
            ยกเลิก
          </Button>
          <Button variant="accent" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner className="size-4" /> : <Icon name="check" className="size-4" />}
            บันทึก
          </Button>
        </div>
      )}
    </section>
  );
}

function Field({
  item,
  override,
  onChange,
}: {
  item: SettingItem;
  override: unknown;
  onChange: (v: unknown) => void;
}) {
  const value = override !== undefined ? override : item.value;

  if (item.type === "bool") {
    const on = Boolean(value);
    return (
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm">{item.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={item.label}
          onClick={() => onChange(!on)}
          className={`relative h-6 w-11 shrink-0 rounded-full border shadow-[inset_0_1px_2px_0_var(--glass-shade)] transition-colors ${
            on ? "border-accent/40 bg-accent" : "border-line bg-raised"
          }`}
        >
          <span
            className={`absolute top-[3px] size-[18px] rounded-full bg-white shadow-md transition-[left] duration-300 [transition-timing-function:var(--ease-spring)] ${
              on ? "left-[23px]" : "left-[3px]"
            }`}
          />
        </button>
      </label>
    );
  }

  if (item.type === "select") {
    return (
      <div>
        <div className="mb-1.5 text-sm">{item.label}</div>
        <div className="flex flex-wrap gap-2">
          {(item.options ?? []).map((o) => (
            <Chip key={o} active={String(value) === o} onClick={() => onChange(o)}>
              {o}
            </Chip>
          ))}
        </div>
      </div>
    );
  }

  if (item.type === "list" || item.type === "idlist") {
    const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
    return (
      <div>
        <label className="mb-1.5 block text-sm" htmlFor={item.key}>
          {item.label}
          <span className="ml-1.5 text-xs text-faint">(บรรทัดละหนึ่งค่า)</span>
        </label>
        <textarea
          id={item.key}
          rows={4}
          value={text}
          onChange={(e) =>
            onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
          }
          className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-accent"
        />
      </div>
    );
  }

  // int/float/id — ตัวเลขทั้งหมด แต่ id เก็บเป็นข้อความ (Discord ID ยาวเกินความแม่นของ number)
  // float ต้องพิมพ์จุดทศนิยมได้ เลยใช้ inputMode="decimal" (numeric ซ่อนจุดบนคีย์บอร์ดมือถือ)
  const isId = item.type === "id";
  const isFloat = item.type === "float";
  return (
    <div>
      <label className="mb-1.5 block text-sm" htmlFor={item.key}>
        {item.label}
      </label>
      <input
        id={item.key}
        type="text"
        inputMode={isId ? "numeric" : isFloat ? "decimal" : "numeric"}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange(isId ? e.target.value.trim() : Number(e.target.value) || 0)
        }
        className="tnum w-full rounded-md border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-accent"
      />
    </div>
  );
}

/* ---------------- จอ OLED ---------------- */

function OledPicker() {
  const toast = useToast();
  const { data, reload } = useFetch<OledConfig>("/api/oled");
  const [busy, setBusy] = useState(false);

  async function pick(page: string) {
    setBusy(true);
    try {
      const r = await api.post<ActionResult>("/api/oled", { page });
      toast(r.message, "ok");
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "เปลี่ยนหน้าจอไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  return (
    <section>
      <SectionTitle>จอเล็กบนตัวเครื่อง</SectionTitle>
      <Card className="p-4">
        <p className="mb-3 text-xs text-muted">
          เลือกว่าจะให้จอ OLED ค้างอยู่ที่หน้าไหน
        </p>
        <div className="flex flex-wrap gap-2">
          {data.pages.map((p) => (
            <Chip
              key={p.id}
              active={data.page === p.id}
              onClick={() => !busy && void pick(p.id)}
            >
              {p.label}
            </Chip>
          ))}
        </div>
      </Card>
    </section>
  );
}

/* ---------------- ล็อกเซิร์ฟเวอร์ ---------------- */

function ServerLock() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run(path: string) {
    setBusy(true);
    try {
      const r = await api.post<ActionResult>(path);
      toast(r.message, r.ok ? "ok" : "error");
    } catch (err) {
      toast(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section>
      <SectionTitle>ควบคุมเซิร์ฟเวอร์</SectionTitle>
      <Card className="space-y-2 p-4">
        <p className="text-xs text-muted">
          ล็อก = ปิดสิทธิ์ส่งข้อความทุกห้องพร้อมกัน ใช้ตอนโดนบุก
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              confirming ? void run("/api/action/lock") : setConfirming(true)
            }
          >
            <Icon name="lock" className="size-4" />
            {confirming ? "ยืนยันล็อก" : "ล็อก"}
          </Button>
          <Button disabled={busy} onClick={() => void run("/api/action/unlock")}>
            <Icon name="unlock" className="size-4" />
            ปลดล็อก
          </Button>
        </div>
      </Card>
    </section>
  );
}

/* ---------------- ทดสอบ Claude ---------------- */

interface ClaudeTestResult {
  ok: boolean;
  model: string;
  ms?: number;
  enabled?: boolean;
  error?: string;
  result?: {
    score: number;
    zone: string;
    reason?: string;
    target?: string;
    spamScore?: number;
    spamType?: "scam" | "advert" | "evasion" | "none";
  } | null;
  action?: "ignore" | "review" | "review-delete" | "auto";
  spamCard?: boolean;
}

const ACTION_TEXT: Record<NonNullable<ClaudeTestResult["action"]>, { text: string; tone: string }> = {
  ignore: { text: "ปล่อยผ่าน ไม่ทำอะไร", tone: "text-ok" },
  review: { text: "ขึ้นการ์ดหน้าแรกให้ mod ตัดสิน (ข้อความยังอยู่)", tone: "text-warn" },
  "review-delete": { text: "ลบข้อความ แต่ไม่เตือน", tone: "text-warn" },
  auto: { text: "ลบข้อความ + เตือนสมาชิกอัตโนมัติ", tone: "text-alert" },
};

const SPAM_TEXT = { scam: "หลอกลวง/scam", advert: "โฆษณา/ขายของ", evasion: "เลี่ยงฟิลเตอร์", none: "ไม่ใช่ spam" };

function ScoreBar({ label, value }: { label: string; value: number }) {
  const tone = value >= 0.9 ? "bg-alert" : value >= 0.5 ? "bg-warn" : "bg-ok";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tnum font-semibold">{value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * พิมพ์ข้อความแล้วให้ Claude ตัดสินจริง — ดูว่าบอทจะทำอะไรถ้ามีคนพิมพ์แบบนี้ในเซิร์ฟ
 * ไม่ลบ/ไม่เตือน/ไม่บันทึกอะไร · mod ใช้ได้ด้วย (จำกัดจำนวนครั้งฝั่ง server เพราะเสียค่า API)
 */
function ClaudeTest() {
  const [text, setText] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<ClaudeTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setOut(await api.post<ClaudeTestResult>("/api/ai/test", { text, context }));
    } catch (err) {
      setOut(null);
      setError(err instanceof Error ? err.message : "ทดสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const r = out?.ok ? out.result : null;
  return (
    <section>
      <SectionTitle>ทดสอบ Claude</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-xs text-muted">
          ลองพิมพ์ข้อความ แล้วดูว่า Claude ให้คะแนนเท่าไร และบอทจะทำอะไรถ้ามีคนพิมพ์แบบนี้ในเซิร์ฟ
          — แค่ทดสอบ ไม่ลบ ไม่เตือน ไม่ขึ้น log
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">
            บริบทก่อนหน้า (ไม่บังคับ) — บรรทัดละข้อความ แบบ <code>ชื่อ: ข้อความ</code>
          </span>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={3000}
            rows={3}
            placeholder={"เอ: เมื่อกี้ใครเล่นแพ้วะ\nบี: ก็มึงไง 555"}
            className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
        <span className="block text-xs font-medium text-muted">ข้อความที่จะให้ Claude ตัดสิน</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run();
          }}
          maxLength={1000}
          rows={3}
          placeholder="เช่น แจก Nitro ฟรี ทักแชทมารับ"
          className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <Button variant="accent" full disabled={busy || !text.trim()} onClick={() => void run()}>
          {busy ? <Spinner className="size-4" /> : <Icon name="bot" className="size-4" />}
          {busy ? "Claude กำลังตัดสิน…" : "ส่งให้ Claude ตัดสิน"}
        </Button>

        {error && <p className="text-sm text-alert">{error}</p>}

        {out && !out.ok && (
          <p className="text-sm text-alert">
            เรียก Claude ไม่ได้: {out.error} — ตอนนี้ข้อความจริงในเซิร์ฟจะถูกปล่อยผ่านหมด
          </p>
        )}

        {out?.ok && (
          <div className="fade-in space-y-3 rounded-md border border-line bg-raised/40 p-3">
            {r ? (
              <>
                <ScoreBar label="toxic" value={r.score} />
                <ScoreBar label={`spam · ${SPAM_TEXT[r.spamType ?? "none"]}`} value={r.spamScore ?? 0} />
                {r.target && r.target !== "ไม่มี" && (
                  <p className="text-sm">
                    <span className="text-muted">ด่า/แซะใคร:</span> <b>{r.target}</b>
                  </p>
                )}
                {r.reason && <p className="text-sm">“{r.reason}”</p>}
              </>
            ) : (
              <p className="text-sm text-muted">Claude ไม่ยอมตัดสินข้อความนี้ — ของจริงจะปล่อยผ่าน</p>
            )}
            <div className="space-y-0.5 border-t border-line pt-2 text-sm">
              <div>
                บอทจะ:{" "}
                <b className={ACTION_TEXT[out.action ?? "ignore"].tone}>
                  {ACTION_TEXT[out.action ?? "ignore"].text}
                </b>
              </div>
              {out.spamCard && <div className="text-warn">+ ส่งการ์ด spam เข้าคิวให้ mod</div>}
              {out.enabled === false && (
                <div className="text-alert">แต่ตอนนี้ปิด AI mod อยู่ ของจริงจะไม่ทำอะไร</div>
              )}
              <div className="tnum text-xs text-faint">
                {out.model} · {((out.ms ?? 0) / 1000).toFixed(1)} วิ
              </div>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

/* ---------------- ใครเข้า dashboard ได้ ---------------- */

interface AccessList {
  roles: { id: string; name: string | null; role: "admin" | "mod" }[];
  people: { id: string; name: string; role: "admin" | "mod" }[];
}

/**
 * ดูอย่างเดียว — สิทธิ์มาจากยศใน Discord ทั้งหมด
 * เพิ่ม/ถอดคนทำที่ Discord (ให้/ถอดยศ) ส่วนยศไหนนับเป็น admin/mod ตั้งใน "ตั้งค่าบอท" ด้านบน
 */
function AccessPeople({ me }: { me: string }) {
  const { data } = useFetch<AccessList>("/api/access");

  return (
    <section>
      <SectionTitle>ใครเข้า dashboard ได้</SectionTitle>
      <Card className="divide-y divide-line">
        <p className="p-4 text-sm text-muted">
          เข้าได้ด้วยบัญชี Discord ที่มียศตามที่ตั้งไว้ในหัวข้อ "สิทธิ์เข้า dashboard" ของตั้งค่าบอท
          คนที่มีสิทธิ์ Administrator ในเซิร์ฟเป็น admin เสมอ — ถอดยศใน Discord แล้วหลุดจากเว็บทันที
        </p>
        {!data ? (
          <div className="flex justify-center p-6 text-muted">
            <Spinner />
          </div>
        ) : (
          <>
            {data.roles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 py-3">
                {data.roles.map((r) => (
                  <Badge key={`${r.role}-${r.id}`} tone={r.role === "admin" ? "accent" : "plain"}>
                    {r.role === "admin" ? "admin" : "mod"}: {r.name ?? `ไม่พบยศ ${r.id}`}
                  </Badge>
                ))}
              </div>
            )}
            {data.people.length === 0 ? (
              <p className="p-4 text-sm text-faint">ยังไม่มีข้อมูล (บอทไม่ได้ต่อ Discord)</p>
            ) : (
              data.people.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar id={p.id} name={p.name} size="md" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.name}
                    {p.name === me && <span className="ml-1.5 text-xs text-faint">(คุณ)</span>}
                  </span>
                  <Badge tone={p.role === "admin" ? "accent" : "plain"}>{p.role}</Badge>
                </div>
              ))
            )}
          </>
        )}
      </Card>
    </section>
  );
}

/* ---------------- ออกจากระบบ ---------------- */

function SignOut({ username, userId }: { username: string; userId: string }) {
  return (
    <section>
      <Card className="flex items-center gap-3 p-4">
        <Avatar id={userId} name={username} size="md" />
        <span className="min-w-0 flex-1 truncate text-sm">
          เข้าใช้งานในชื่อ <b>{username}</b>
        </span>
        {/* ใช้ form POST จริง ๆ ไม่ใช่ fetch — ปลายทางตอบด้วย redirect ให้เบราว์เซอร์เดินตาม */}
        <form method="post" action="/logout">
          <Button type="submit" variant="danger">
            <Icon name="logout" className="size-4" />
            ออกจากระบบ
          </Button>
        </form>
      </Card>
    </section>
  );
}
