import type { SystemInfo } from "../lib/types";
import { fmtDuration, fmtMb } from "../lib/format";
import { Card, Meter } from "./ui";
import { Icon, type IconName } from "./Icon";

/** เกณฑ์สีของแต่ละค่า — เขียวปกติ, เหลืองเริ่มตึง, แดงต้องดูแล้ว */
function tone(value: number, warn: number, alert: number) {
  if (value >= alert) return "alert" as const;
  if (value >= warn) return "warn" as const;
  return "ok" as const;
}

function Row({
  icon,
  label,
  value,
  pct,
  meterTone,
}: {
  icon: IconName;
  label: string;
  value: string;
  pct?: number;
  meterTone?: "accent" | "warn" | "alert" | "ok";
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon name={icon} className="size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-muted">{label}</span>
          <span className="tnum text-sm font-semibold">{value}</span>
        </div>
        {pct !== undefined && (
          <div className="mt-1.5">
            <Meter pct={pct} tone={meterTone ?? "accent"} />
          </div>
        )}
      </div>
    </div>
  );
}

export function SystemCard({ sys }: { sys: SystemInfo }) {
  const { cpu, memory, disk, power, uptime } = sys;

  // 3.0 GHz ที่ 85°C คือเพดานของเครื่องนี้ — ตั้งเหลืองที่ 70 แดงที่ 80
  const tempTone = cpu.tempC === null ? "ok" : tone(cpu.tempC, 70, 80);

  // เตือนเรื่องไฟ/ความร้อนเฉพาะตอนที่มีอะไรผิดปกติจริง ๆ
  const flags: { text: string; now: boolean }[] = [];
  if (power.underVoltageNow || power.lowVoltageAlarm)
    flags.push({ text: "ไฟตกอยู่ตอนนี้", now: true });
  else if (power.underVoltagePast)
    flags.push({ text: "เคยไฟตกตั้งแต่บูตล่าสุด", now: false });
  if (power.throttledNow) flags.push({ text: "กำลังถูกลดความเร็ว", now: true });
  else if (power.throttledPast)
    flags.push({ text: "เคยถูกลดความเร็วตั้งแต่บูตล่าสุด", now: false });
  if (power.tempLimitNow) flags.push({ text: "ชนเพดานอุณหภูมิ", now: true });

  return (
    <Card level="glass" className="space-y-3.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-muted">
          <Icon name="cpu" className="size-4" />
          เครื่องที่บอทรันอยู่
        </span>
        <span className="text-xs text-faint">
          เปิดมา {fmtDuration(uptime.hostSec)}
        </span>
      </div>

      {cpu.tempC !== null && (
        <Row
          icon="thermometer"
          label="อุณหภูมิ CPU"
          value={`${cpu.tempC.toFixed(1)}°C`}
          // 40°C = เย็นสนิท, 85°C = เพดาน — ยืดสเกลให้เห็นความต่างในช่วงที่ใช้จริง
          pct={((cpu.tempC - 40) / 45) * 100}
          meterTone={tempTone}
        />
      )}

      {cpu.freqMhz !== null && (
        <Row
          icon="zap"
          label="ความเร็ว CPU"
          value={`${(cpu.freqMhz / 1000).toFixed(1)} GHz`}
          {...(cpu.maxFreqMhz
            ? { pct: (cpu.freqMhz / cpu.maxFreqMhz) * 100, meterTone: "accent" as const }
            : {})}
        />
      )}

      <Row
        icon="chart"
        label="หน่วยความจำ"
        value={`${fmtMb(memory.totalMb - memory.availableMb)} / ${fmtMb(memory.totalMb)}`}
        pct={memory.usedPct}
        meterTone={tone(memory.usedPct, 75, 90)}
      />

      {disk && (
        <Row
          icon="disk"
          label="พื้นที่ดิสก์"
          value={`เหลือ ${disk.freeGb} GB`}
          pct={disk.usedPct}
          meterTone={tone(disk.usedPct, 80, 92)}
        />
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-faint">
        {sys.fanRpm !== null && (
          <span className="flex items-center gap-1">
            <Icon name="fan" className="size-3.5" />
            พัดลม {sys.fanRpm.toLocaleString("th-TH")} rpm
          </span>
        )}
        <span className="flex items-center gap-1">
          <Icon name="clock" className="size-3.5" />
          บอททำงานมา {fmtDuration(uptime.botSec)}
        </span>
        <span>บอทใช้ RAM {fmtMb(sys.process.rssMb)}</span>
      </div>

      {flags.length > 0 && (
        <div className="space-y-1.5">
          {flags.map((f) => (
            <div
              key={f.text}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${
                f.now ? "bg-alert-soft text-alert" : "bg-warn-soft text-warn"
              }`}
            >
              <Icon name="warn" className="size-3.5 shrink-0" />
              {f.text}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
