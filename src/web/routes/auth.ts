/** เข้า/ออกระบบ + บอกว่าตอนนี้เป็นใคร */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, destroySession, SESSION_TTL_MS } from "../../auth/session.js";
import type { AccessResolver } from "../../auth/access.js";
import { authorizeUrl, identify, newState, oauthConfig } from "../../auth/discordOAuth.js";
import { logEvent } from "../../utils/logger.js";
import { notifySecurity } from "../../modules/securityAlerts.js";
import { isOwner } from "../middleware/auth.js";
import { cookieOptions, COOKIE_NAME, metaOf, parseCookies } from "../middleware/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * เทมเพลตหน้า login — อ่านครั้งเดียวตอนโหลดโมดูล
 *
 * ต้องประกอบ HTML ฝั่ง server เพราะ CSP ตัด script-src 'unsafe-inline' ออกแล้ว
 * ข้อความแจ้งเตือนเลยใส่ลงไปตรงนี้แทนการให้สคริปต์ในหน้าอ่าน ?error= เอง
 */
const LOGIN_HTML = readFileSync(join(__dirname, "..", "public", "login.html"), "utf8");

/** cookie เก็บ state ของ OAuth ระหว่างไป Discord แล้วกลับมา — อายุสั้น ใช้ครั้งเดียว */
const STATE_COOKIE = "__Host-oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * ข้อความแจ้งเตือนบนหน้า login — key มาจาก ?error= แต่ข้อความทุกอันเขียนตายตัวในนี้
 * ไม่มีค่าจาก query string หลุดเข้าไปใน HTML จึงไม่มีช่องให้ยัดสคริปต์ผ่าน URL
 */
const MESSAGES: Record<string, string> = {
  norole: "บัญชี Discord นี้ไม่มียศแอดมินหรือ mod ในเซิร์ฟเวอร์ — ให้แอดมินเพิ่มยศก่อน",
  state: "หมดเวลาหรือเปิดลิงก์ข้ามหน้าต่าง — กดเข้าสู่ระบบใหม่อีกครั้ง",
  failed: "เชื่อมต่อ Discord ไม่สำเร็จ — ลองใหม่อีกครั้ง",
  denied: "ยกเลิกการเข้าสู่ระบบแล้ว",
  config:
    "ยังไม่ได้ตั้งค่า login ด้วย Discord (ต้องมี CLIENT_ID, DISCORD_CLIENT_SECRET และ DASHBOARD_URL ใน .env)",
};

export function renderLogin(query: Request["query"]): string {
  const key = typeof query.error === "string" ? query.error : "";
  const message = MESSAGES[key] ?? (oauthConfig() ? "" : MESSAGES.config);
  return LOGIN_HTML.replace(
    "<!--ERROR-->",
    message ? `<p class="error" role="alert">${message}</p>` : "",
  );
}

/**
 * เส้นทางที่เข้าได้ "ก่อน" login — ต้อง mount ก่อน requireAuth
 * fetchImpl แยกออกมาให้เทสแทน Discord จริงได้
 */
export function publicAuthRoutes(
  client: Client | undefined,
  access: AccessResolver,
  fetchImpl: typeof fetch = fetch,
): Router {
  const r = Router();

  r.get("/login", (req: Request, res: Response) => {
    res.type("html").send(renderLogin(req.query));
  });

  // ขั้น 1: ส่งไปหน้าอนุญาตของ Discord พร้อม state สุ่ม (กันคนอื่นยัด code ของเขาให้เรา login แทน)
  r.get("/auth/discord", (_req: Request, res: Response) => {
    const cfg = oauthConfig();
    if (!cfg) {
      res.redirect("/login?error=config");
      return;
    }
    const state = newState();
    res.cookie(STATE_COOKIE, state, { ...cookieOptions(), maxAge: STATE_TTL_MS });
    res.redirect(authorizeUrl(cfg, state));
  });

  // ขั้น 2: Discord ส่งกลับมาพร้อม code → แลกเป็นตัวตน → เช็คยศ → สร้าง session
  r.get("/auth/discord/callback", async (req: Request, res: Response) => {
    const ip = req.ip ?? "?";
    const cfg = oauthConfig();
    const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, cookieOptions()); // ใช้ครั้งเดียว ไม่ว่าผลจะเป็นยังไง
    if (!cfg) {
      res.redirect("/login?error=config");
      return;
    }
    if (req.query.error) {
      res.redirect("/login?error=denied"); // กด "ยกเลิก" ที่หน้า Discord
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !expected || state !== expected) {
      res.redirect("/login?error=state");
      return;
    }

    let user;
    try {
      user = await identify(cfg, code, fetchImpl);
    } catch (err) {
      console.error("login ด้วย Discord ไม่สำเร็จ:", err);
      res.redirect("/login?error=failed");
      return;
    }

    const who = await access(user.id).catch(() => null);
    if (!who) {
      res.redirect("/login?error=norole");
      // คนนอกพยายามเข้า dashboard — แจ้งไว้ แต่ไม่ใช่เหตุร้ายแรง (อาจเป็นสมาชิกกดเล่น)
      void notifySecurity("login dashboard ถูกปฏิเสธ", `${user.username} (${user.id}) ไม่มียศ · IP ${ip}`);
      return;
    }

    const token = createSession(user.id, metaOf(req));
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
    res.redirect("/");
    if (client) {
      void logEvent(client, "info", "system", "system_login", "เข้าสู่ระบบ dashboard (Discord)", [
        { name: "User", value: `${who.name} (${user.id})` },
        { name: "สิทธิ์", value: who.role },
        { name: "IP", value: ip },
      ]);
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
      isOwner: isOwner(res.locals.userId),
    });
  });
  return r;
}
