import { useState } from "react";
import type { LogEntry, LogLevel, Verdict } from "../lib/types";
import { fmtClock, fmtDateTime, fmtTime } from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { Badge, Card } from "./ui";
import { iconOf, labelOf } from "../lib/categories";
import { linkifyField } from "../lib/discordLinks";
import { useLinkTarget } from "../lib/linkTarget";
import { Avatar, idFromLabel } from "./Avatar";

/**
 * ระดับของ log บอกด้วยเส้นซ้ายสีเดียวกับการ์ดคิว — ปกติเป็นเส้นสีฟอร์ม (ไม่แย่งสายตา)
 * ชื่อระดับใส่ไว้ให้โปรแกรมอ่านหน้าจอ เพราะสีอย่างเดียวคนตาบอดสีแยกไม่ได้
 */
const LEVEL: Record<LogLevel, { rule: string; name: string }> = {
  info: { rule: "rule-none", name: "ปกติ" },
  warn: { rule: "rule-warn", name: "เตือน" },
  alert: { rule: "rule-alert", name: "แจ้งเตือน" },
};

/**
 * หนึ่งบรรทัดของ log
 *
 * ย่อไว้ก่อนแล้วกดขยาย — บนมือถือถ้ากาง fields ของทุกรายการพร้อมกัน
 * จะเลื่อนหาอันที่ต้องการไม่เจอ เพราะแต่ละรายการกินความสูงเกินครึ่งจอ
 */
export function LogRow({
  entry,
  verdict,
  onVerdict,
  isNew,
  guildId,
}: {
  entry: LogEntry;
  verdict?: Verdict | null;
  onVerdict?: (logId: number, v: Verdict | null) => void;
  isNew?: boolean;
  /** ใช้ประกอบลิงก์ห้อง — ไม่มีก็แสดงเป็นข้อความเฉย ๆ */
  guildId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const linkTarget = useLinkTarget();
  const lv = LEVEL[entry.level];
  const isAi = entry.event === "security_ai";

  /*
   * ชื่อบอทพาร์ทเนอร์ — ตัดวงเล็บ id ท้ายออกจากช่อง "ผู้ทำ"
   * อ่านจากตัว log เองแทนที่จะดึงทะเบียนมาเทียบ เพราะชื่อถูกเขียนลงไปตอนบันทึกแล้ว
   * แถวเก่าที่ย้ายหมวดย้อนหลังก็ถูกเขียนชื่อทับให้เหมือนกัน
   */
  const partnerName =
    entry.category === "partner"
      ? (entry.fields
          .find((f) => f.name === "ผู้ทำ")
          ?.value.replace(/\s*\(\d+\)\s*$/, "") ?? null)
      : null;

  /*
   * คนหลักของเหตุการณ์ — log เขียนไว้ในช่องแบบ "ชื่อ (id)" (User / เป้าหมาย / ผู้ทำ)
   * ใช้โชว์รูปโปรไฟล์หน้าหัวข้อ ให้กวาดตาดูแล้วรู้ว่าเรื่องของใครโดยไม่ต้องกดขยาย
   */
  const subject = entry.fields
    .filter((f) => ["User", "เป้าหมาย", "สมาชิก", "ผู้ทำ"].includes(f.name))
    .map((f) => ({ id: idFromLabel(f.value), name: f.value.replace(/\s*\(\d+\)\s*$/, "") }))
    .find((x) => x.id);

  return (
    <Card
      // isNew = เพิ่งไหลเข้ามาจากสตรีมสด — ขอบเรืองขึ้นชั่วคราว + แสงวาบพาดหนึ่งครั้ง
      className={`rule-l ${lv.rule} overflow-hidden ${isNew ? "flash" : ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
      >
        {/* เวลาเป็นคอลัมน์ซ้าย — log คือลำดับเหตุการณ์ อ่านไล่ลงตามเวลาได้เลย */}
        <span className="tnum w-11 shrink-0 text-sm text-faint" title={fmtTime(entry.timestamp)}>
          {fmtClock(entry.timestamp)}
        </span>
        <span className="sr-only">{lv.name}:</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {subject && <Avatar id={subject.id} name={subject.name} size="xs" className="mt-0.5" />}
            <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug">
              {entry.title}
            </span>
          </div>

          {entry.description && (
            <p
              className={`mt-0.5 text-xs text-muted ${open ? "" : "line-clamp-2"}`}
            >
              {entry.description}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {/*
              หมวดแสดงเป็นไอคอนล้วน — ชื่อหมวดอยู่ใน title/aria-label ไว้ให้เอาเมาส์ชี้
              และให้โปรแกรมอ่านหน้าจอออกเสียงได้ ไม่ใช่ไอคอนลอย ๆ ที่ไม่มีความหมาย
            */}
            <span
              title={`หมวด: ${labelOf(entry.category)}`}
              aria-label={`หมวด: ${labelOf(entry.category)}`}
              className="inline-flex items-center rounded-md bg-raised p-1 text-muted"
            >
              <Icon
                name={iconOf(entry.category)}
                className="size-3.5"
              />
            </span>
            {partnerName && (
              <Badge tone="accent">
                <Icon name="bot" className="size-3" />
                {partnerName}
              </Badge>
            )}
            {verdict && (
              <Badge tone={verdict === "toxic" ? "alert" : "ok"}>
                {verdict === "toxic" ? "ตัดสิน: ผิดจริง" : "ตัดสิน: AI จับผิด"}
              </Badge>
            )}
            {entry.fields.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-faint">
                <Icon
                  name="chevron"
                  className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
                />
                {entry.fields.length} รายละเอียด
              </span>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="fade-in border-t border-line bg-raised px-3.5 py-3">
          <dl className="space-y-1.5 text-xs">
            {entry.fields.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex gap-2">
                <dt className="w-24 shrink-0 text-faint">{f.name}</dt>
                {/*
                  break-words = ข้อความยาวต้องตัดบรรทัด ไม่ดันหน้าให้เลื่อนแนวนอน
                  whitespace-pre-line = รายชื่อคนในห้องคั่นด้วย \n ต้องขึ้นบรรทัดจริง
                */}
                <dd className="min-w-0 flex-1 whitespace-pre-line break-words">
                  {linkifyField(f.name, f.value, guildId ?? null, linkTarget)}
                </dd>
              </div>
            ))}
            <div className="flex gap-2 pt-1 text-faint">
              <dt className="w-24 shrink-0">เวลา</dt>
              <dd>{fmtDateTime(entry.timestamp)}</dd>
            </div>
          </dl>

          {isAi && onVerdict && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-2 text-xs text-faint">
                AI ตัดสินถูกไหม — คำตอบจะถูกเก็บเป็นข้อมูลเทรนรอบหน้า
              </p>
              <div className="flex gap-2">
                <VerdictButton
                  active={verdict === "toxic"}
                  tone="alert"
                  icon="check"
                  label="ผิดจริง"
                  onClick={() =>
                    onVerdict(entry.id, verdict === "toxic" ? null : "toxic")
                  }
                />
                <VerdictButton
                  active={verdict === "ok"}
                  tone="ok"
                  icon="x"
                  label="จับผิดตัว"
                  onClick={() => onVerdict(entry.id, verdict === "ok" ? null : "ok")}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function VerdictButton({
  active,
  tone,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  tone: "alert" | "ok";
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  const on =
    tone === "alert"
      ? "border-alert bg-alert-soft text-alert"
      : "border-ok bg-ok-soft text-ok";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border py-2 text-xs font-medium transition ${
        active ? on : "border-line text-muted active:bg-raised"
      }`}
    >
      <Icon name={icon} className="size-3.5" />
      {label}
    </button>
  );
}
