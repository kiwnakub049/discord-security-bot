/**
 * สมัคร/เลิกรับแจ้งเตือนมือถือ (Web Push) — แยกต่อเครื่อง เลือกเรื่องที่รับได้เอง
 * ทุกเส้นอยู่หลัง requireAuth: เครื่องผูกกับบัญชีที่ login อยู่
 */
import { Router, type Request, type Response } from "express";
import { cleanTopics, deleteSub, getSub, saveSub } from "../../store/pushStore.js";
import { pushTest, vapidPublicKey } from "../../modules/webPush.js";
import { rateLimit } from "../middleware/rateLimit.js";

/** endpoint ต้องเป็น https ของ push service จริง — กันคนยัด URL ภายในให้ server ยิงไปหา (SSRF) */
const PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function validEndpoint(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1000) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname)) ? raw : null;
  } catch {
    return null;
  }
}

const b64url = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);

export function pushRoutes(): Router {
  const r = Router();
  const me = (res: Response) => String(res.locals.userId);
  const langOf = (res: Response) => (res.locals.lang === "en" ? "en" : "th");

  r.get("/api/push/key", (_req: Request, res: Response) => {
    res.json({ publicKey: vapidPublicKey() });
  });

  /** สถานะของเครื่องนี้ — หน้าเว็บส่ง endpoint ของตัวเองมาถาม */
  r.post("/api/push/status", (req: Request, res: Response) => {
    const endpoint = validEndpoint(req.body?.endpoint);
    const sub = endpoint ? getSub(endpoint, me(res)) : undefined;
    res.json({ subscribed: !!sub, topics: sub?.topics ?? [] });
  });

  r.post("/api/push/subscribe", (req: Request, res: Response) => {
    const s = req.body?.subscription;
    const endpoint = validEndpoint(s?.endpoint);
    if (!endpoint || !b64url(s?.keys?.p256dh, 200) || !b64url(s?.keys?.auth, 100)) {
      res.status(400).json({ ok: false, error: "ข้อมูลการสมัครรับแจ้งเตือนไม่ถูกต้อง" });
      return;
    }
    const topics = cleanTopics(req.body?.topics);
    saveSub({ endpoint, userId: me(res), keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, topics, lang: langOf(res) });
    res.json({ ok: true, topics });
  });

  r.post("/api/push/unsubscribe", (req: Request, res: Response) => {
    const endpoint = validEndpoint(req.body?.endpoint);
    res.json({ ok: !!endpoint && deleteSub(endpoint, me(res)) });
  });

  r.post("/api/push/test", rateLimit("push-test", 10, 10 * 60_000), async (req: Request, res: Response) => {
    const endpoint = validEndpoint(req.body?.endpoint);
    const sub = endpoint ? getSub(endpoint, me(res)) : undefined;
    if (!sub) {
      res.status(404).json({ ok: false, error: "เครื่องนี้ยังไม่ได้เปิดรับแจ้งเตือน" });
      return;
    }
    const ok = await pushTest(sub);
    res.status(ok ? 200 : 502).json(
      ok ? { ok: true, message: "ส่งแล้ว — ควรเด้งในไม่กี่วินาที" } : { ok: false, error: "ส่งไม่สำเร็จ — ลองปิดแล้วเปิดรับแจ้งเตือนใหม่" },
    );
  });

  return r;
}
