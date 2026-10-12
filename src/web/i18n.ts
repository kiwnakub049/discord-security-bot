/**
 * แปลข้อความที่ server ตอบกลับหน้าเว็บ (ไทย → อังกฤษ) ตามภาษาที่ผู้ใช้เลือก
 *
 * route ทั้งหมดยังเขียนข้อความไทยเหมือนเดิม — middleware นี้ดัก res.json แล้วแปล
 * field `message` / `error` ระดับบนสุดให้ ถ้าคำขอมาจากหน้าเว็บภาษาอังกฤษ
 * (header X-Lang จากหน้าเว็บ หรือ cookie lang สำหรับหน้า HTML ที่ server วาดเอง)
 *
 * คำแปลอยู่ใน ./i18n/en.ts: EXACT = ตรงตัว, PATTERNS = ข้อความที่มีตัวแปรปน (regex)
 * ไม่เจอคำแปล = ส่งไทยเดิม (ดีกว่าว่าง)
 */
import type { NextFunction, Request, Response } from "express";
import { EXACT, PATTERNS } from "./i18n/en.js";

export type Lang = "th" | "en";

export function langOf(req: Request): Lang {
  const h = req.get("x-lang");
  if (h === "en" || h === "th") return h;
  const c = /(?:^|;\s*)lang=(en|th)\b/.exec(req.get("cookie") ?? "")?.[1];
  if (c === "en" || c === "th") return c;
  // ไม่เคยเลือก = ตามภาษาเครื่อง (เหมือนหน้าเว็บ) · "*" หรือไม่ส่งมา = ไทย
  const al = (req.get("accept-language") ?? "").trim().toLowerCase();
  return /^[a-z]{2}/.test(al) && !al.startsWith("th") ? "en" : "th";
}

/** แปลข้อความเดียว — ไทยล้วนที่มีตัวแปรก็ลอง pattern ทีละอัน */
export function tr(th: string, lang: Lang): string {
  if (lang !== "en" || !th) return th;
  const exact = EXACT[th];
  if (exact !== undefined) return exact;
  for (const [re, en] of PATTERNS) {
    const m = re.exec(th);
    if (m) return typeof en === "string" ? th.replace(re, en) : en(m, (s) => tr(s, lang));
  }
  return th;
}

/** ดัก res.json — แปล message / error ระดับบนสุด */
export function i18nMiddleware(req: Request, res: Response, next: NextFunction): void {
  const lang = langOf(req);
  res.locals.lang = lang;
  if (lang === "en") {
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const b = body as Record<string, unknown>;
        const out: Record<string, unknown> = { ...b };
        for (const k of ["message", "error"]) if (typeof b[k] === "string") out[k] = tr(b[k] as string, "en");
        return json(out);
      }
      return json(body);
    };
  }
  next();
}
