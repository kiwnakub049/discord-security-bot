import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { db } from "./db.js";

export type LogLevel = "info" | "warn" | "alert";

// หมวดหมู่ของ log — ใช้แยกเมนูฝั่งซ้ายใน dashboard
export type LogCategory =
  | "security" // anti-raid / anti-spam / auto-mod
  | "member" // เข้า-ออกเซิร์ฟเวอร์
  | "voice" // ห้องเสียง
  | "audit" // permission / ban / kick / role (ที่คนทำ)
  | "partner" // บอทของพาร์ทเนอร์ เช่น Kill Switch — ดู src/partners.ts
  | "system"; // ระบบ (บอทออนไลน์, lock/unlock)

/** ทุกหมวด เรียงตามลำดับที่อยากให้โชว์บนหน้าเว็บ */
export const LOG_CATEGORIES: readonly LogCategory[] = [
  "security",
  "member",
  "voice",
  "audit",
  "partner",
  "system",
];

export interface LogEntry {
  id: number;
  timestamp: number; // epoch ms
  level: LogLevel;
  category: LogCategory;
  event: string; // ชนิดย่อยภายในหมวด เช่น voice_move, audit_ban (ไว้กรองละเอียดบนเว็บ)
  title: string;
  description?: string;
  fields: { name: string; value: string }[];
}

type LogRow = {
  id: number;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  event: string;
  title: string;
  description: string | null;
  fields: string;
};

function rowToEntry(r: LogRow): LogEntry {
  return {
    id: r.id,
    timestamp: r.timestamp,
    level: r.level,
    category: r.category,
    event: r.event,
    title: r.title,
    fields: JSON.parse(r.fields) as { name: string; value: string }[],
    ...(r.description ? { description: r.description } : {}),
  };
}

// แจ้ง subscriber (เช่น SSE ของเว็บ) เมื่อมี log ใหม่
export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(0); // SSE client ได้ไม่จำกัด

/**
 * ลบ log ที่เก่ากว่า retentionDays ทิ้ง (0 = ปิด ไม่ลบ) — คืนจำนวนแถวที่ลบ
 */
export function pruneLogs(): number {
  const days = config.logging.retentionDays;
  if (!days || days <= 0) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return db.prepare("DELETE FROM logs WHERE timestamp < ?").run(cutoff).changes;
}

/**
 * เตรียม log store — ตาราง logs ถูกสร้างใน initDb() แล้ว
 * ลบ log เก่าตอนบูต + ตั้งลบซ้ำทุกวัน (retention ตาม config.logging.retentionDays)
 */
export async function initLogStore(): Promise<void> {
  const pruned = pruneLogs();
  if (pruned) console.log(`🧹 ลบ log เก่าเกิน ${config.logging.retentionDays} วัน: ${pruned} รายการ`);
  setInterval(pruneLogs, 24 * 60 * 60 * 1000).unref();

  const n = (db.prepare("SELECT COUNT(*) AS n FROM logs").get() as { n: number })
    .n;
  console.log(`📒 log ใน DB: ${n} รายการ`);
}

const insertLog = db.prepare(
  `INSERT INTO logs (timestamp, level, category, event, title, description, fields)
   VALUES (@timestamp, @level, @category, @event, @title, @description, @fields)`,
);

/**
 * เพิ่ม log ใหม่: เขียนลง DB แล้วแจ้ง subscriber
 */
export async function addLog(
  level: LogLevel,
  category: LogCategory,
  event: string,
  title: string,
  fields: { name: string; value: string }[] = [],
  description?: string,
): Promise<LogEntry> {
  const timestamp = Date.now();
  const info = insertLog.run({
    timestamp,
    level,
    category,
    event,
    title,
    description: description ?? null,
    fields: JSON.stringify(fields),
  });

  const entry: LogEntry = {
    id: Number(info.lastInsertRowid),
    timestamp,
    level,
    category,
    event,
    title,
    fields,
    ...(description ? { description } : {}),
  };

  logEmitter.emit("log", entry);
  return entry;
}

/** ดึง log เดียวตาม id — ใช้ตอนบันทึกคำตัดสินของ mod ว่าอ้างถึงการตรวจจับอันไหน */
export function getLogById(id: number): LogEntry | null {
  const row = db.prepare("SELECT * FROM logs WHERE id = ?").get(id) as
    | LogRow
    | undefined;
  return row ? rowToEntry(row) : null;
}

/**
 * ดึง log จาก DB พร้อม filter — ใช้โดย API ของเว็บ
 * คืนรายการล่าสุดก่อน (id มากสุดก่อน)
 */
export function getLogs(opts: {
  level?: LogLevel;
  category?: LogCategory;
  limit?: number;
  search?: string;
  /**
   * ดึงเฉพาะ event ที่ระบุ (หลายค่าได้)
   * ต้องรับหลายค่าเพราะกิ่งบนหน้าเว็บบางกิ่งรวมหลาย event เช่น
   * "เข้า-ออกเซิร์ฟเวอร์" = member_join + member_leave
   */
  events?: string[];
  /** ดึงเฉพาะที่เก่ากว่า id นี้ — ใช้เลื่อนดูหน้าถัดไป (id เรียงตามเวลาอยู่แล้ว) */
  beforeId?: number;
  /** ดึงเฉพาะที่ใหม่กว่าเวลานี้ (epoch ms) */
  since?: number;
} = {}): LogEntry[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.level) {
    where.push("level = @level");
    params.level = opts.level;
  }
  if (opts.category) {
    where.push("category = @category");
    params.category = opts.category;
  }
  if (opts.search) {
    where.push("(title LIKE @q OR description LIKE @q OR fields LIKE @q)");
    params.q = `%${opts.search}%`;
  }
  if (opts.events?.length) {
    // ต้องสร้าง placeholder ตามจำนวนจริง — better-sqlite3 ไม่ขยาย array ให้เอง
    // ชื่อพารามิเตอร์เลยเป็น ev0, ev1, … แทนที่จะยัดทั้งก้อนเป็นค่าเดียว
    const names = opts.events.map((_, i) => `@ev${i}`);
    where.push(`event IN (${names.join(", ")})`);
    opts.events.forEach((e, i) => {
      params[`ev${i}`] = e;
    });
  }
  if (opts.beforeId && Number.isFinite(opts.beforeId)) {
    where.push("id < @beforeId");
    params.beforeId = Math.floor(opts.beforeId);
  }
  if (opts.since && Number.isFinite(opts.since)) {
    where.push("timestamp >= @since");
    params.since = Math.floor(opts.since);
  }

  // clamp limit: กัน ?limit=-1 (SQLite ตีความเป็น "ไม่จำกัด" → ดึงทั้งตาราง) และค่าเกินจริง
  const rawLimit = opts.limit ?? config.web.maxEntries;
  params.limit = Number.isFinite(rawLimit)
    ? Math.min(5000, Math.max(1, Math.floor(rawLimit)))
    : config.web.maxEntries;
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT * FROM logs ${clause} ORDER BY id DESC LIMIT @limit`,
    )
    .all(params) as LogRow[];
  return rows.map(rowToEntry);
}

/**
 * นับจำนวน log ทั้งตาราง แยกตามระดับและหมวด
 *
 * ต้องนับด้วย SQL ไม่ใช่ดึงแถวมานับเอง — ของเดิมหน้า overview เรียก getLogs()
 * ที่ตัดมาแค่ 500 แถวล่าสุด แล้วเอาไปนับ พอ log เกิน 500 ตัวเลขก็ค้างที่ 500 ตลอด
 */
export function logTotals(since?: number): {
  total: number;
  byLevel: Record<LogLevel, number>;
  byCategory: Record<string, number>;
} {
  const clause = since ? "WHERE timestamp >= @since" : "";
  const params = since ? { since } : {};

  const byLevel: Record<LogLevel, number> = { info: 0, warn: 0, alert: 0 };
  // ตั้งทุกหมวดเป็น 0 ไว้ก่อน เพื่อให้หน้าเว็บได้คีย์ครบเสมอ แม้หมวดนั้นยังไม่มี log เลย
  const byCategory: Record<string, number> = Object.fromEntries(
    LOG_CATEGORIES.map((c) => [c, 0]),
  );
  let total = 0;

  const rows = db
    .prepare(
      `SELECT level, category, COUNT(*) AS n FROM logs ${clause} GROUP BY level, category`,
    )
    .all(params) as { level: LogLevel; category: string; n: number }[];

  for (const r of rows) {
    total += r.n;
    byLevel[r.level] = (byLevel[r.level] ?? 0) + r.n;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.n;
  }
  return { total, byLevel, byCategory };
}

export interface HistoryPoint {
  /** เวลาเริ่มของช่วง (epoch ms) */
  t: number;
  info: number;
  warn: number;
  alert: number;
  total: number;
}

/**
 * จำนวน log ย้อนหลัง แบ่งเป็นช่วง ๆ สำหรับวาดกราฟ
 *
 * แบ่งช่วงด้วยการหารในฝั่ง SQL ((timestamp - from) / size) แทนที่จะดึงทุกแถวมาวนนับ
 * — 90 วันของเซิร์ฟเวอร์นี้เป็นหลักหมื่นแถว ส่งข้าม process ทั้งหมดไม่คุ้ม
 *
 * ช่วงถูกจัดให้ตรงขอบวัน/ชั่วโมงตามเวลาท้องถิ่น ไม่ใช่นับถอยหลังจากตอนนี้
 * กราฟจะได้ไม่ขยับแกนทุกครั้งที่รีเฟรช
 */
export function logHistory(days: number): {
  bucket: "hour" | "day";
  from: number;
  size: number;
  points: HistoryPoint[];
} {
  const n = Math.min(90, Math.max(1, Math.floor(days) || 7));
  const bucket: "hour" | "day" = n <= 2 ? "hour" : "day";
  const size = bucket === "hour" ? 3_600_000 : 86_400_000;

  // ขอบบนคือต้นช่วงถัดไป (ชั่วโมง/วันปัจจุบันยังนับต่ออยู่)
  const now = new Date();
  const edge =
    bucket === "hour"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const count = bucket === "hour" ? n * 24 : n;
  const from = edge.getTime() - count * size;

  const points: HistoryPoint[] = Array.from({ length: count }, (_, i) => ({
    t: from + i * size,
    info: 0,
    warn: 0,
    alert: 0,
    total: 0,
  }));

  const rows = db
    .prepare(
      // CAST ... AS INTEGER จำเป็น — ตัวเลข epoch ms ถูก bind เป็น REAL
      // SQLite เลยหารแบบทศนิยม ได้ b = 6.7243… ซึ่งไม่ตรงกับ index ของ array ไหนเลย
      // (เคยพลาดตรงนี้มาแล้ว กราฟขึ้นศูนย์ทั้งแผงทั้งที่ตัวเลขสรุปด้านบนไม่ใช่ศูนย์)
      // ค่าในช่วงเป็นบวกเสมอ การตัดเศษทิ้งจึงเท่ากับ floor
      `SELECT CAST((timestamp - @from) / @size AS INTEGER) AS b, level, COUNT(*) AS n
         FROM logs
        WHERE timestamp >= @from AND timestamp < @to
        GROUP BY b, level`,
    )
    .all({ from, size, to: edge.getTime() }) as {
    b: number;
    level: LogLevel;
    n: number;
  }[];

  for (const r of rows) {
    const p = points[r.b];
    if (!p) continue; // กันกรณีขอบ ๆ ที่หารแล้วหลุดช่วง
    p[r.level] += r.n;
    p.total += r.n;
  }
  return { bucket, from, size, points };
}
