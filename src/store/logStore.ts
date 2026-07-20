import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { db } from "./db.js";

export type LogLevel = "info" | "warn" | "alert";

// หมวดหมู่ของ log — ใช้แยกเมนูฝั่งซ้ายใน dashboard
export type LogCategory =
  | "security" // anti-raid / anti-spam / auto-mod
  | "member" // เข้า-ออกเซิร์ฟเวอร์
  | "voice" // ห้องเสียง
  | "audit" // permission / ban / kick / role
  | "system"; // ระบบ (บอทออนไลน์, lock/unlock)

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
 * เตรียม log store — ตาราง logs ถูกสร้างใน initDb() แล้ว
 * (เก็บไว้เพื่อความเข้ากันได้กับโค้ดที่เรียกตอนบูต)
 */
export async function initLogStore(): Promise<void> {
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

/**
 * ดึง log จาก DB พร้อม filter — ใช้โดย API ของเว็บ
 * คืนรายการล่าสุดก่อน (id มากสุดก่อน)
 */
export function getLogs(opts: {
  level?: LogLevel;
  category?: LogCategory;
  limit?: number;
  search?: string;
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

  params.limit = opts.limit ?? config.web.maxEntries;
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT * FROM logs ${clause} ORDER BY id DESC LIMIT @limit`,
    )
    .all(params) as LogRow[];
  return rows.map(rowToEntry);
}
