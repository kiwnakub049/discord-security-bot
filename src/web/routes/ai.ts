/**
 * คำตัดสินของ mod ต่อสิ่งที่ AI จับได้ = eval set ไว้วัดความแม่นของ prompt/threshold
 * (ผูกกับ log ที่ event = security_ai เท่านั้น กันคนยิง id มั่วมาปนข้อมูลเทรน)
 */
import { Router, type Request, type Response } from "express";
import { getLogById, type LogEntry } from "../../store/logStore.js";
import { testClassify } from "../../modules/aiMod.js";
import { requireAdmin } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  clearVerdict,
  getAllVerdicts,
  getVerdictMap,
  setVerdict,
  verdictStats,
  type Verdict,
} from "../../store/aiVerdictStore.js";

/** ดึงค่าจาก field ของ log ตามชื่อ */
function fieldOf(entry: LogEntry, name: string): string {
  return entry.fields.find((f) => f.name === name)?.value ?? "";
}

/** "someone (123456789)" -> "123456789" */
function userIdFrom(value: string): string {
  return /\((\d+)\)\s*$/.exec(value)?.[1] ?? "";
}

/** ข้อความทดสอบยาวสุด — ข้อความจริงใน Discord ยาวได้ 2000 แต่แค่ทดสอบไม่ต้องยาวขนาดนั้น */
const TEST_MAX = 1000;

export function aiRoutes(): Router {
  const r = Router();

  /**
   * ทดสอบ Claude — admin เท่านั้น เพราะทุกครั้งเสียค่า API จริง
   * จำกัด 20 ครั้ง / 10 นาที กันกดรัวจนบิลบวม
   */
  r.post(
    "/api/ai/test",
    requireAdmin,
    rateLimit("ai-test", 20, 10 * 60_000),
    async (req: Request, res: Response) => {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text || text.length > TEST_MAX) {
        res.status(400).json({ ok: false, error: `ใส่ข้อความ 1–${TEST_MAX} ตัวอักษร` });
        return;
      }
      res.json(await testClassify(text));
    },
  );

  r.get("/api/ai/verdicts", (_req: Request, res: Response) => {
    res.json({ map: getVerdictMap(), stats: verdictStats() });
  });

  r.post("/api/ai/verdict", (req: Request, res: Response) => {
    const logId = Number(req.body?.logId);
    const raw = req.body?.verdict;
    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json({ ok: false, message: "logId ไม่ถูกต้อง" });
      return;
    }
    // verdict = null คือ "ยกเลิกคำตัดสิน" (กดปุ่มเดิมซ้ำ)
    if (raw === null) {
      const removed = clearVerdict(logId);
      res.json({
        ok: true,
        verdict: null,
        stats: verdictStats(),
        message: removed ? "ยกเลิกแล้ว" : "ไม่มีให้ยกเลิก",
      });
      return;
    }
    if (raw !== "toxic" && raw !== "ok") {
      res.status(400).json({ ok: false, message: "verdict ต้องเป็น toxic, ok หรือ null" });
      return;
    }
    const verdict = raw as Verdict;

    const entry = getLogById(logId);
    if (!entry || entry.event !== "security_ai") {
      res.status(404).json({ ok: false, message: "ไม่พบการตรวจจับของ AI ตาม id นี้" });
      return;
    }

    const text = fieldOf(entry, "ข้อความ");
    const score = Number(fieldOf(entry, "คะแนน"));
    if (!text || !Number.isFinite(score)) {
      res.status(422).json({ ok: false, message: "log นี้ไม่มีข้อความ/คะแนนให้เก็บ" });
      return;
    }

    setVerdict({
      log_id: logId,
      verdict,
      score,
      // spam มี field "ประเภท" -> spam_<type> แยกจาก toxic
      // toxic: alert = ลบอัตโนมัติ (โซน auto), warn = แค่ขึ้นให้ดู (โซน review)
      zone: fieldOf(entry, "ประเภท")
        ? `spam_${fieldOf(entry, "ประเภท")}`
        : entry.level === "alert" ? "auto" : "review",
      text,
      user_id: userIdFrom(fieldOf(entry, "User")),
      decided_by: String(res.locals.username),
    });
    res.json({ ok: true, verdict, stats: verdictStats() });
  });

  /** eval set พร้อมใช้ — บรรทัดละ 1 ตัวอย่าง {text, label} */
  r.get("/api/ai/export.jsonl", (_req: Request, res: Response) => {
    // ข้อความที่ลงท้าย "…" = ถูกตัดตอนขึ้น log (ของเก่าก่อนขยาย excerpt) — ไม่ครบ ไม่เอามาวัดผล
    const rows = getAllVerdicts().filter((row) => !row.text.endsWith("…"));
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="ai-labels.jsonl"');
    res.send(
      rows
        .map((row) =>
          JSON.stringify({
            text: row.text,
            label: row.verdict === "toxic" ? 1 : 0,
            model_score: row.score,
            zone: row.zone,
            decided_at: row.decided_at,
          }),
        )
        .join("\n") + (rows.length ? "\n" : ""),
    );
  });

  return r;
}
