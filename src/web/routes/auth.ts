/** เข้า/ออกระบบ + บอกว่าตอนนี้เป็นใคร */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../config.js";
import { createSession, destroySession, SESSION_TTL_MS } from "../../auth/session.js";
import { userExists, verifyPassword } from "../../auth/users.js";
import { logEvent } from "../../utils/logger.js";
import { notifySecurity } from "../../modules/securityAlerts.js";
import { isOwner } from "../middleware/auth.js";
import {
  beginLoginAttempt,
  cookieOptions,
  COOKIE_NAME,
  endLoginAttempt,
  loginLockedMinutes,
  metaOf,
  parseCookies,
} from "../middleware/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * เทมเพลตหน้า login — อ่านครั้งเดียวตอนโหลดโมดูล
 *
 * ต้องประกอบ HTML ฝั่ง server เพราะ CSP ตัด script-src 'unsafe-inline' ออกแล้ว
 * ของเดิมใช้ <script> ในหน้าอ่าน ?error= มาโชว์ ซึ่งตอนนี้จะถูกบล็อกเงียบ ๆ
 * ผู้ใช้กรอกรหัสผิดแล้วจะไม่เห็นอะไรเลย นอกจากหน้าเด้งกลับมาเปล่า ๆ
 */
const LOGIN_HTML = readFileSync(join(__dirname, "..", "public", "login.html"), "utf8");

/**
 * ใส่กล่องข้อความแจ้งเตือนลงในหน้า login
 *
 * ข้อความทุกอันประกอบขึ้นในนี้ล้วน ๆ ไม่มีค่าจาก query string หลุดเข้าไปใน HTML
 * (locked ถูกแปลงเป็นจำนวนเต็มก่อนเสมอ) — จึงไม่มีช่องให้ยัดสคริปต์ผ่าน URL
 */
function renderLogin(query: Request["query"]): string {
  let message = "";
  const locked = Number(query.locked);
  if (Number.isFinite(locked) && locked > 0) {
    const mins = Math.min(999, Math.ceil(locked));
    message = `ลองเข้าสู่ระบบผิดหลายครั้งเกินไป — ถูกล็อกชั่วคราว ลองใหม่อีกครั้งใน ${mins} นาที`;
  } else if (query.error) {
    message = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  }
  return LOGIN_HTML.replace(
    "<!--ERROR-->",
    message ? `<p class="error" role="alert">${message}</p>` : "",
  );
}

/** เส้นทางที่เข้าได้ "ก่อน" login — ต้อง mount ก่อน requireAuth */
export function publicAuthRoutes(client?: Client): Router {
  const r = Router();

  r.get("/login", (req: Request, res: Response) => {
    res.type("html").send(renderLogin(req.query));
  });

  r.post("/login", async (req: Request, res: Response) => {
    const ip = req.ip ?? "?";
    // จองสิทธิ์ลองแบบ synchronous ก่อน await (กัน concurrency bypass ของ lockout)
    if (beginLoginAttempt(ip) === "locked") {
      res.redirect(
        `/login?locked=${loginLockedMinutes(ip) || Math.ceil(config.web.loginLockMs / 60000)}`,
      );
      return;
    }
    const username = String(req.body?.username ?? "");
    const password = String(req.body?.password ?? "");
    let ok = false;
    try {
      ok = Boolean(
        username && password && (await verifyPassword(username, password)),
      );
    } catch {
      ok = false;
    }
    const justLocked = endLoginAttempt(ip, ok);

    if (ok) {
      const token = createSession(username, metaOf(req));
      res.cookie(COOKIE_NAME, token, {
        ...cookieOptions(),
        maxAge: SESSION_TTL_MS,
      });
      res.redirect("/");
      if (client) {
        void logEvent(client, "info", "system", "system_login", "เข้าสู่ระบบ dashboard", [
          { name: "User", value: username },
          { name: "IP", value: ip },
        ]);
      }
      return;
    }

    const mins = loginLockedMinutes(ip);
    res.redirect(`/login?${mins ? "locked=" + mins : "error=1"}`);
    if (justLocked) {
      // โชว์ชื่อเฉพาะเมื่อตรงบัญชีที่มีจริง — คนชอบเผลอพิมพ์ "รหัสผ่าน" ลงช่อง username
      // ถ้าส่งดิบ ๆ รหัสจะไปโผล่ในห้อง log ให้ทุกคนเห็น
      const who = userExists(username) ? username : "(ไม่ตรงบัญชีที่มีอยู่)";
      void notifySecurity(
        "ล็อก IP — login ผิดหลายครั้ง",
        `IP ${ip} ลองผิดครบ ${config.web.loginMaxAttempts} ครั้ง · เป้าหมาย: ${who}`,
      );
      if (client) {
        // ล็อก IP เพราะลองผิดหลายครั้ง = น่าจะมีคนพยายามเจาะ
        void logEvent(client, "alert", "system", "system_login", "🚨 ล็อก IP — login ผิดหลายครั้ง", [
          { name: "IP", value: ip },
          { name: "ลองชื่อ", value: who },
        ]);
      }
    }
  });

  r.post("/logout", (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    destroySession(cookies[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, cookieOptions());
    res.redirect("/login");
  });

  return r;
}

/** เส้นทางที่ต้อง login แล้ว */
export function meRoutes(client?: Client): Router {
  const r = Router();
  r.get("/api/me", (_req: Request, res: Response) => {
    // guildId ส่งไปให้หน้าเว็บประกอบลิงก์ discord.com/channels/<guild>/<channel>
    // ให้กดจากชื่อห้องใน log แล้วกระโดดไปห้องนั้นในแอปได้เลย
    const guildId =
      process.env.GUILD_ID ?? client?.guilds.cache.first()?.id ?? null;
    res.json({
      username: res.locals.username,
      role: res.locals.role ?? "mod",
      guildId,
      // เมนูบางอย่างมีให้เจ้าของเครื่องคนเดียว — ฝั่งเว็บใช้ค่านี้ตัดสินใจว่าจะโชว์ไหม
      // (ด่านจริงอยู่ที่ requireOwner ฝั่งเซิร์ฟเวอร์ ค่านี้แค่ทำให้เมนูไม่โผล่มาเปล่า ๆ)
      isOwner: isOwner(res.locals.username),
    });
  });
  return r;
}
