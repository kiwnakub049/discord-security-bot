import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { requestNotifyPermission, setNotifyEnabled, useNotifyEnabled } from "../lib/notify";
import {
  ALL_TOPICS,
  DEFAULT_TOPICS,
  disablePush,
  enablePush,
  pushStatus,
  pushSupport,
  testPush,
  type PushTopic,
} from "../lib/push";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { Button, Spinner } from "./ui";

const TOPIC_TEXT: Record<PushTopic, { label: string; hint: string }> = {
  queue: { label: t("การ์ดใหม่ในคิวรอดำเนินการ"), hint: t("Claude จับข้อความ, รอยืนยันแบน, ticket ใหม่ ฯลฯ") },
  mention: { label: t("แชททีม: แท็กหรือทักส่วนตัว"), hint: t("มีคน @ คุณ, @all หรือส่งข้อความส่วนตัวมา") },
  general: { label: t("แชททีม: ทุกข้อความในห้องรวม"), hint: t("อาจเด้งบ่อย") },
};

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
        on ? "border-accent/40 bg-accent" : "border-line bg-raised"
      }`}
    >
      <span
        className={`absolute top-[3px] size-[18px] rounded-full bg-white shadow-md transition-[left] duration-300 ${
          on ? "left-[23px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

/**
 * ตั้งค่าการแจ้งเตือน (เปิดจากปุ่มกระดิ่ง)
 * - ในหน้าเว็บ: เสียง + เด้งตอนมีเหตุร้ายแรง ขณะเปิดเว็บอยู่ (เหมือนเดิม)
 * - มือถือ/ปิดเว็บอยู่: Web Push แยกต่อเครื่อง เลือกเรื่องที่รับเอง
 */
export function NotifySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const inPage = useNotifyEnabled();
  const support = pushSupport();
  const [status, setStatus] = useState<{ subscribed: boolean; topics: PushTopic[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const denied = typeof Notification !== "undefined" && Notification.permission === "denied";

  useEffect(() => {
    if (!open || support !== "ok") return;
    let alive = true;
    pushStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({ subscribed: false, topics: [] }));
    return () => {
      alive = false;
    };
  }, [open, support]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      toast(
        m === "denied"
          ? t("เครื่องนี้ไม่อนุญาตการแจ้งเตือน — เปิดในตั้งค่าของเบราว์เซอร์/มือถือก่อน")
          : m || t("ทำไม่สำเร็จ ลองใหม่อีกครั้ง"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  const turnOn = () =>
    run(async () => {
      await enablePush(DEFAULT_TOPICS);
      setStatus({ subscribed: true, topics: DEFAULT_TOPICS });
      toast(t("เปิดรับแจ้งเตือนบนเครื่องนี้แล้ว"), "ok");
    });
  const setTopic = (topic: PushTopic, on: boolean) =>
    run(async () => {
      const cur = status?.topics ?? [];
      const next = ALL_TOPICS.filter((x) => (x === topic ? on : cur.includes(x)));
      await enablePush(next);
      setStatus({ subscribed: true, topics: next });
    });
  const turnOff = () =>
    run(async () => {
      await disablePush();
      setStatus({ subscribed: false, topics: [] });
      toast(t("ปิดรับแจ้งเตือนบนเครื่องนี้แล้ว"), "ok");
    });
  const test = () => run(async () => toast(await testPush(), "ok"));

  return (
    <Sheet open={open} onClose={onClose} title={t("การแจ้งเตือน")}>
      <div className="space-y-6 pb-2">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("แจ้งเตือนบนมือถือ / ตอนปิดเว็บ")}</h3>

          {support === "ios-install" ? (
            <div className="rule-l rule-info space-y-2 rounded-md border border-line bg-surface p-3 text-sm">
              <p className="font-medium">{t("iPhone ต้องเพิ่มเว็บนี้ลงหน้าโฮมก่อน")}</p>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>{t("เปิดเว็บนี้ใน Safari แล้วกดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น)")}</li>
                <li>{t("เลือก \"เพิ่มไปยังหน้าจอโฮม\"")}</li>
                <li>{t("เปิดจากไอคอนบนหน้าโฮม แล้วกดกระดิ่งตรงนี้อีกครั้ง")}</li>
              </ol>
              <p className="text-xs text-faint">{t("ต้องเป็น iOS 16.4 ขึ้นไป")}</p>
            </div>
          ) : support === "unsupported" ? (
            <p className="text-sm text-muted">{t("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนแบบ push — ลอง Chrome, Edge, Firefox หรือ Safari")}</p>
          ) : !status ? (
            <div className="flex justify-center py-4 text-muted">
              <Spinner />
            </div>
          ) : !status.subscribed ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                {t("เด้งแจ้งเตือนบนเครื่องนี้แม้ปิดเว็บหรือล็อกจออยู่ — ตั้งแยกแต่ละเครื่อง")}
              </p>
              {denied && (
                <p className="text-sm text-alert">
                  {t("เครื่องนี้บล็อกการแจ้งเตือนของเว็บนี้ไว้ — เปิดในตั้งค่าของเบราว์เซอร์/มือถือก่อน")}
                </p>
              )}
              <Button variant="accent" full disabled={busy} onClick={() => void turnOn()}>
                {busy ? <Spinner className="size-4" /> : <Icon name="bell" className="size-4" />}
                {t("เปิดรับแจ้งเตือนบนเครื่องนี้")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {ALL_TOPICS.map((topic) => (
                <label key={topic} className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm">{TOPIC_TEXT[topic].label}</span>
                    <span className="block text-xs text-muted">{TOPIC_TEXT[topic].hint}</span>
                  </span>
                  <Switch
                    on={status.topics.includes(topic)}
                    label={TOPIC_TEXT[topic].label}
                    disabled={busy}
                    onChange={(v) => void setTopic(topic, v)}
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button disabled={busy} onClick={() => void test()}>
                  {t("ลองส่งแจ้งเตือน")}
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void turnOff()}>
                  {t("ปิดรับบนเครื่องนี้")}
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-2 border-t border-line pt-4">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t("เสียง + เด้งตอนเปิดเว็บอยู่")}</span>
              <span className="block text-xs text-muted">{t("เหตุร้ายแรง (alert) ระหว่างเปิดหน้าเว็บค้างไว้")}</span>
            </span>
            <Switch
              on={inPage}
              label={t("เสียง + เด้งตอนเปิดเว็บอยู่")}
              onChange={(v) => {
                setNotifyEnabled(v);
                if (v) requestNotifyPermission();
              }}
            />
          </label>
        </section>
      </div>
    </Sheet>
  );
}
