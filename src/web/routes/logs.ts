/** อ่าน log — รายการ (เลื่อนดูทีละหน้า), กราฟย้อนหลัง, และสตรีมสด */
import { Router, type Request, type Response } from "express";
import type { AccessResolver } from "../../auth/access.js";
import { sessionExists } from "../../auth/session.js";
import { BOM, toCsv } from "../csv.js";
import {
  getLogs,
  logEmitter,
  logHistory,
  LOG_CATEGORIES,
  type LogCategory,
  type LogEntry,
  type LogLevel,
} from "../../store/logStore.js";
import { PARTNER_BOTS } from "../../partners.js";

const LEVELS = new Set(["info", "warn", "alert"]);
// สร้างจาก LOG_CATEGORIES เพื่อไม่ให้ลืมอัปเดตตอนเพิ่มหมวดใหม่
const CATEGORIES = new Set<string>(LOG_CATEGORIES);

/**
 * อ่าน query ที่ต้องเป็นค่าจากชุดที่กำหนดเท่านั้น — รับหลายค่าได้ทั้ง ?a=x,y และ ?a=x&a=y
 * ค่าที่ไม่รู้จักทิ้งไป ไม่เหลือเลย = ไม่กรอง
 */
function manyOf<T extends string>(v: unknown, allowed: Set<string>): T[] {
  const raw = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : [];
  return [...new Set(raw.map((x) => x.trim()).filter((x) => allowed.has(x)))] as T[];
}

/** ช่วงเวลาย้อนหลังที่หน้าเว็บเลือกได้ — คุมเป็นชุดตายตัว ไม่รับ ms ดิบจาก client */
const WINDOWS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

/**
 * ชื่อ event ที่ยอมรับ — a-z กับ _ เท่านั้น ยาวไม่เกิน 40
 * ไม่ได้เช็คกับรายชื่อตายตัวเพราะ event เพิ่มใหม่ได้เรื่อย ๆ ตามโมดูลที่เขียนเพิ่ม
 * แต่ยังต้องกันค่าประหลาดไม่ให้หลุดเข้าไปเป็นพารามิเตอร์ของ query
 */
const EVENT_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** แปลง query ของ request เป็นเงื่อนไขที่ getLogs() รับ (ใช้ร่วมกันทั้งดูและ export) */
function filtersFrom(query: Request["query"]) {
  const levels = manyOf<LogLevel>(query.level, LEVELS);
  const categories = manyOf<LogCategory>(query.category, CATEGORIES);
  const search =
    typeof query.search === "string" && query.search.trim()
      ? query.search.trim().slice(0, 200)
      : undefined;
  const window = typeof query.window === "string" ? WINDOWS[query.window] : undefined;

  // รับได้ทั้ง ?event=a&event=b และ ?event=a,b — จำกัด 20 ตัวกัน query ยาวเกินเหตุ
  const raw = Array.isArray(query.event)
    ? query.event.map(String)
    : typeof query.event === "string"
      ? query.event.split(",")
      : [];
  const events = [...new Set(raw.map((e) => e.trim()).filter((e) => EVENT_RE.test(e)))]
    .slice(0, 20);

  return {
    ...(levels.length ? { levels } : {}),
    ...(categories.length ? { categories } : {}),
    ...(search ? { search } : {}),
    ...(events.length ? { events } : {}),
    ...(window ? { since: Date.now() - window } : {}),
  };
}

export function logRoutes(access: AccessResolver): Router {
  const r = Router();

  r.get("/api/logs", (req: Request, res: Response) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const beforeId = Number(req.query.beforeId) || undefined;

    // ขอเกินมา 1 แถวเพื่อรู้ว่ายังมีต่อไหม โดยไม่ต้องยิง COUNT(*) อีกรอบ
    const rows = getLogs({
      limit: limit + 1,
      ...filtersFrom(req.query),
      ...(beforeId ? { beforeId } : {}),
    });

    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      entries,
      hasMore,
      nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
    });
  });

  /**
   * ดาวน์โหลดเป็น CSV ตามตัวกรองเดียวกับที่เห็นบนหน้าจอ
   *
   * ทำฝั่ง server ไม่ใช่ฝั่งเบราว์เซอร์แบบเดิม — ของเดิมส่งออกได้แค่แถวที่โหลดมาแล้ว
   * ซึ่งพอเปลี่ยนมาเป็นการเลื่อนทีละหน้า จะกลายเป็น "ส่งออกเฉพาะที่เผอิญเลื่อนถึง"
   */
  r.get("/api/logs/export.csv", (req: Request, res: Response) => {
    const rows = getLogs({ ...filtersFrom(req.query), limit: 5000 });
    const csv = toCsv(
      ["เวลา", "ระดับ", "หมวด", "เหตุการณ์", "หัวข้อ", "รายละเอียด", "ข้อมูลเพิ่มเติม"],
      rows.map((e) => [
        new Date(e.timestamp).toLocaleString("th-TH", { hour12: false }),
        e.level,
        e.category,
        e.event,
        e.title,
        e.description ?? "",
        e.fields.map((f) => `${f.name}=${f.value}`).join(" | "),
      ]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="logs.csv"');
    res.send(BOM + csv);
  });

  r.get("/api/logs/history", (req: Request, res: Response) => {
    res.json(logHistory(Number(req.query.days) || 7));
  });

  /** ทะเบียนบอทพาร์ทเนอร์ — หน้าเว็บใช้ตั้งชื่อหมวดและขึ้นป้ายกำกับ */
  r.get("/api/partners", (_req: Request, res: Response) => {
    res.json(PARTNER_BOTS);
  });

  // ---------- สตรีมสด (SSE) ----------
  r.get("/api/stream", (req: Request, res: Response) => {
    const userId = res.locals.userId as string;
    const sessionId = res.locals.sessionId as string;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // ปิด buffer ของ reverse proxy — ไม่งั้นข้อความค้างจนกว่า buffer จะเต็ม
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    const onLog = (entry: LogEntry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };
    logEmitter.on("log", onLog);

    // ทุก 15 วิ: ส่ง ping กันหลุด + เช็คสิทธิ์ซ้ำ (ถูกถอดยศ หรือ session ถูก revoke → ปิด stream)
    // ไม่งั้นคนที่ถูกถอดยศ/ถูกเตะออกแล้ว ยังรับ log สดต่อได้ตราบใดที่สายไม่ขาด
    // (ping ทุก 15 วิยิ่งเลี้ยงสายไว้) — request อื่นโดนด่าน requireAuth แต่ stream ไม่ได้ผ่านซ้ำ
    const tick = setInterval(async () => {
      const stillOk = sessionExists(sessionId) && (await access(userId).catch(() => null));
      if (!stillOk) {
        cleanup();
        res.end();
        return;
      }
      res.write(": ping\n\n");
    }, 15_000);

    function cleanup() {
      clearInterval(tick);
      logEmitter.off("log", onLog);
    }
    req.on("close", cleanup);
  });

  return r;
}
