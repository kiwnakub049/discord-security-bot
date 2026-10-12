import { t } from "../lib/i18n";
import { useState } from "react";
import type { History } from "../lib/types";
import { fmtDay, fmtNum } from "../lib/format";

/**
 * กราฟแท่งซ้อนของจำนวนเหตุการณ์ย้อนหลัง
 *
 * วาดเป็น SVG เองแทนที่จะลงไลบรารีกราฟ — ทั้งหน้าใช้กราฟเดียว รูปแบบเดียว
 * ไลบรารีอย่าง recharts กินพื้นที่บันเดิลมากกว่าโค้ดทั้งไฟล์นี้หลายสิบเท่า
 *
 * แท่งเรียงจากล่างขึ้นบน: info → warn → alert
 * ให้สีแรงสุด (alert) อยู่บนสุดเพราะเป็นตัวที่ตาต้องจับได้ก่อน
 */

const LEVELS = [
  { key: "info", label: t("ปกติ"), fill: "var(--c-info)", op: 0.45 },
  { key: "warn", label: t("เตือน@@level"), fill: "var(--c-warn)", op: 0.85 },
  { key: "alert", label: t("แจ้งเตือน@@level"), fill: "var(--c-alert)", op: 1 },
] as const;

const H = 120; // ความสูงพื้นที่วาด (หน่วยพิกัดใน viewBox)

export function HistoryChart({ history }: { history: History }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = history.points;
  const max = Math.max(1, ...points.map((p) => p.total));
  const n = points.length;
  // ความกว้างต่อช่อง — ใช้ viewBox ยืดเต็มกว้างเสมอ ไม่ต้องวัดขนาดจอ
  const slot = 100 / n;
  const barW = Math.max(slot * 0.55, slot - (history.bucket === "hour" ? 0.25 : 1.2));

  const active = hover !== null ? points[hover] : null;
  const isHour = history.bucket === "hour";

  const labelFor = (ts: number) =>
    isHour ? `${new Date(ts).getHours()}:00` : fmtDay(ts);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="tnum text-2xl font-semibold">
          {fmtNum(points.reduce((s, p) => s + p.total, 0))}
          <span className="ml-1.5 text-sm font-normal text-muted">
            {isHour ? t("เหตุการณ์ใน 24 ชม.") : t("เหตุการณ์ใน {n} วัน", { n })}
          </span>
        </div>
        {active && (
          <div className="tnum text-right text-xs text-muted">
            <div className="font-medium text-text">{labelFor(active.t)}</div>
            <div>
              {t("{n} รายการ", { n: active.total })}
              {active.alert > 0 && (
                <span className="text-alert"> · {t("{n} แจ้งเตือน", { n: active.alert })}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 100 ${H}`}
        preserveAspectRatio="none"
        className="h-32 w-full touch-pan-y"
        role="img"
        aria-label={t("กราฟเหตุการณ์ย้อนหลัง {n} ช่วง สูงสุด {max} รายการ", { n, max })}
        onMouseLeave={() => setHover(null)}
      >
        {/* เส้นอ้างอิงแนวนอน — ครึ่งหนึ่งและยอดสูงสุด */}
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1="0"
            x2="100"
            y1={H - f * H}
            y2={H - f * H}
            stroke="var(--c-border)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {points.map((p, i) => {
          const x = i * slot + (slot - barW) / 2;
          let y = H;
          return (
            <g
              key={p.t}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
            >
              {/* แถบใสเต็มความสูง = พื้นที่รับการแตะ ให้นิ้วโดนง่ายแม้แท่งจริงจะเตี้ย */}
              <rect
                x={i * slot}
                y="0"
                width={slot}
                height={H}
                fill="transparent"
                onClick={() => setHover(hover === i ? null : i)}
              />
              {LEVELS.map((lv) => {
                const v = p[lv.key];
                if (!v) return null;
                const h = (v / max) * H;
                y -= h;
                return (
                  <rect
                    key={lv.key}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(0, h - 0.4)}
                    fill={lv.fill}
                    opacity={hover === null || hover === i ? lv.op : lv.op * 0.35}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="mt-1.5 flex justify-between text-xs text-faint">
        <span>{labelFor(points[0]!.t)}</span>
        {n > 6 && <span>{labelFor(points[Math.floor(n / 2)]!.t)}</span>}
        <span>{isHour ? t("ตอนนี้") : t("วันนี้")}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {LEVELS.map((lv) => (
          <span key={lv.key} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-[2px]"
              style={{ background: lv.fill, opacity: lv.op }}
            />
            {lv.label}
          </span>
        ))}
      </div>
    </div>
  );
}
