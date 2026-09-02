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
  { key: "info", label: "ปกติ", fill: "var(--c-info)", op: 0.55 },
  { key: "warn", label: "เตือน", fill: "var(--c-warn)", op: 0.85 },
  { key: "alert", label: "แจ้งเตือน", fill: "var(--c-alert)", op: 1 },
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

  const labelFor = (t: number) =>
    isHour ? `${new Date(t).getHours()}:00` : fmtDay(t);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="tnum text-2xl font-bold">
          {fmtNum(points.reduce((s, p) => s + p.total, 0))}
          <span className="ml-1.5 text-xs font-normal text-muted">
            เหตุการณ์ใน {isHour ? "24 ชม." : `${n} วัน`}
          </span>
        </div>
        {active && (
          <div className="tnum text-right text-xs text-muted">
            <div className="font-medium text-text">{labelFor(active.t)}</div>
            <div>
              {active.total} รายการ
              {active.alert > 0 && (
                <span className="text-alert"> · {active.alert} แจ้งเตือน</span>
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
        aria-label={`กราฟเหตุการณ์ย้อนหลัง ${n} ช่วง สูงสุด ${max} รายการ`}
        onMouseLeave={() => setHover(null)}
      >
        {/*
          ไล่สีในแท่งจากอ่อน (บน) ไปเข้ม (ล่าง) ให้แต่ละชั้นดูเป็นของเหลวในหลอดแก้ว
          ไม่ใช่แถบสีทึบ — เข้าชุดกับกระจกที่เหลือของหน้า
        */}
        <defs>
          {LEVELS.map((lv) => (
            <linearGradient key={lv.key} id={`bar-${lv.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lv.fill} stopOpacity="0.95" />
              <stop offset="100%" stopColor={lv.fill} stopOpacity="0.55" />
            </linearGradient>
          ))}
        </defs>

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
                  <g key={lv.key}>
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      fill={`url(#bar-${lv.key})`}
                      opacity={hover === null || hover === i ? lv.op : lv.op * 0.4}
                      rx="0.6"
                    />
                    {/* เส้นแสงบางที่ยอดชั้น — ขอบรับแสงเหมือนที่การ์ดกระจกทำ */}
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.min(1.2, h)}
                      fill={lv.fill}
                      opacity={hover === null || hover === i ? 1 : 0.4}
                      rx="0.6"
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="mt-1.5 flex justify-between text-[10px] text-faint">
        <span>{labelFor(points[0]!.t)}</span>
        {n > 6 && <span>{labelFor(points[Math.floor(n / 2)]!.t)}</span>}
        <span>{isHour ? "ตอนนี้" : "วันนี้"}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
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
