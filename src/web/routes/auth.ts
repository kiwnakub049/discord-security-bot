/** เข้า/ออกระบบ + บอกว่าตอนนี้เป็นใคร */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, destroySession, SESSION_TTL_MS } from "../../auth/session.js";
import type { AccessResolver } from "../../auth/access.js";
import { authorizeUrl, identify, newState, oauthConfig } from "../../auth/discordOAuth.js";
import { consumeLoginLink, peekLoginLink, rememberState, takeState } from "../../auth/loginLink.js";
import { logEvent } from "../../utils/logger.js";
import { notifySecurity } from "../../modules/securityAlerts.js";
import { isOwner, seesSystem } from "../middleware/auth.js";
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
  link: "ลิงก์หมดอายุหรือถูกใช้ไปแล้ว — พิมพ์ /dashboard ใน Discord เพื่อขอลิงก์ใหม่",
  config:
    "ยังไม่ได้ตั้งค่า login ด้วย Discord (ต้องมี CLIENT_ID, DISCORD_CLIENT_SECRET และ DASHBOARD_URL ใน .env)",
};

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * authorizeHref = ลิงก์ไปหน้าอนุญาตของ Discord ตรง ๆ (ไม่ผ่าน /auth/discord)
 * มือถือส่งลิงก์ discord.com ให้แอป Discord เปิดได้ก็ต่อเมื่อเป็นการแตะลิงก์ข้ามโดเมนตรง ๆ
 * ถ้าผ่าน redirect ของเรามักเปิดในเบราว์เซอร์แทน
 */
export function renderLogin(query: Request["query"], authorizeHref?: string): string {
  const key = typeof query.error === "string" ? query.error : "";
  const message = MESSAGES[key] ?? (oauthConfig() ? "" : MESSAGES.config);
  let html = LOGIN_HTML.replace(
    "<!--ERROR-->",
    message ? `<p class="error" role="alert">${message}</p>` : "",
  );
  if (authorizeHref) html = html.replace('href="/auth/discord"', `href="${escapeAttr(authorizeHref)}"`);
  return html;
}

/** หน้ายืนยันของลิงก์จาก /dashboard — ปุ่ม POST (GET ไม่ใช้ token กันแอปโหลดลิงก์ล่วงหน้า) */
export function renderLinkConfirm(token: string): string {
  const start = LOGIN_HTML.indexOf("<!--ACTION-->");
  const end = LOGIN_HTML.indexOf("<!--/ACTION-->");
  const form = `<form method="post" action="/auth/link">
        <input type="hidden" name="t" value="${escapeAttr(token)}" />
        <button type="submit" class="discord">เข้าสู่ระบบ</button>
      </form>
      <p class="note">ลิงก์จาก /dashboard ใน Discord · ใช้ได้ครั้งเดียว</p>`;
  return (LOGIN_HTML.slice(0, start) + form + LOGIN_HTML.slice(end + "<!--/ACTION-->".length))
    .replace("<!--ERROR-->", "")
    .replace("<title>เข้าสู่ระบบ — Undawn Dashboard</title>", "<title>ยืนยันเข้าสู่ระบบ — Undawn Dashboard</title>");
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

  // ออก state ตั้งแต่เปิดหน้า แล้วให้ปุ่มชี้ไป Discord ตรง ๆ — มือถือจะได้ส่งให้แอป Discord เปิด
  r.get("/login", (req: Request, res: Response) => {
    const cfg = oauthConfig();
    if (!cfg) {
      res.type("html").send(renderLogin(req.query));
      return;
    }
    const state = newState();
    rememberState(state);
    res.cookie(STATE_COOKIE, state, { ...cookieOptions(), maxAge: STATE_TTL_MS });
    res.set("Cache-Control", "no-store"); // state ต่อหน้า ห้าม cache
    res.type("html").send(renderLogin(req.query, authorizeUrl(cfg, state)));
  });

  // ขั้น 1: ส่งไปหน้าอนุญาตของ Discord พร้อม state สุ่ม (กันคนอื่นยัด code ของเขาให้เรา login แทน)
  r.get("/auth/discord", (_req: Request, res: Response) => {
    const cfg = oauthConfig();
    if (!cfg) {
      res.redirect("/login?error=config");
      return;
    }
    const state = newState();
    rememberState(state);
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
    // state ต้องเป็นของที่เราออกให้: ตรงกับ cookie (เบราว์เซอร์เดิม) หรืออยู่ใน DB
    // (แอป Discord พากลับมาใน browser ในแอปที่ไม่มี cookie) · ใช้ได้ครั้งเดียวทั้งสองทาง
    const issued = takeState(state);
    if (!code || !state || (state !== expected && !issued)) {
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

    startSession(req, res, user.id, who, "Discord");
  });

  // ---------- ลิงก์ครั้งเดียวจาก /dashboard ใน Discord ----------
  r.get("/auth/link", (req: Request, res: Response) => {
    const t = req.query.t;
    if (!peekLoginLink(t)) {
      res.redirect("/login?error=link");
      return;
    }
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.type("html").send(renderLinkConfirm(String(t)));
  });

  r.post("/auth/link", async (req: Request, res: Response) => {
    const userId = consumeLoginLink(req.body?.t);
    if (!userId) {
      res.redirect(303, "/login?error=link");
      return;
    }
    // ถามยศใหม่ — ถ้าถูกถอดยศระหว่างขอลิงก์กับกด ก็เข้าไม่ได้
    const who = await access(userId).catch(() => null);
    if (!who) {
      res.redirect(303, "/login?error=norole");
      return;
    }
    startSession(req, res, userId, who, "ลิงก์ /dashboard");
  });

  function startSession(
    req: Request,
    res: Response,
    userId: string,
    who: { name: string; role: string },
    via: string,
  ): void {
    const token = createSession(userId, metaOf(req));
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
    res.redirect(303, "/");
    if (client) {
      void logEvent(client, "info", "system", "system_login", `เข้าสู่ระบบ dashboard (${via})`, [
        { name: "User", value: `${who.name} (${userId})` },
        { name: "สิทธิ์", value: who.role },
        { name: "IP", value: req.ip ?? "?" },
      ]);
    }
  }

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
      userId: res.locals.userId, // หน้าเว็บใช้แสดงรูปโปรไฟล์ของตัวเอง
      role: res.locals.role ?? "mod",
      guildId,
      // เมนูบางอย่างมีให้เจ้าของเครื่องคนเดียว — ฝั่งเว็บใช้ค่านี้ตัดสินใจว่าจะโชว์ไหม
      // (ด่านจริงอยู่ที่ requireOwner ฝั่งเซิร์ฟเวอร์ ค่านี้แค่ทำให้เมนูไม่โผล่มาเปล่า ๆ)
      isOwner: isOwner(res.locals.userId),
      // admin ที่ไม่ใช่เจ้าของไม่เห็นตั้งค่าระบบ/สถานะ Pi (ด่านจริงคือ requireSystemView)
      seesSystem: seesSystem(res.locals.role, res.locals.userId),
    });
  });
  return r;
}
