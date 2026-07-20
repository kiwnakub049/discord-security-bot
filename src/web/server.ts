import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { type Client, type Guild } from "discord.js";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { getMember, listMembers } from "../idcard/members.js";
import { getCardImage } from "../idcard/cardCache.js";
import { getVoiceState, getVoiceStates } from "../store/voiceState.js";
import {
  getActivity,
  levelProgress,
  topByVoice,
  topByXp,
  type Activity,
} from "../store/activityStore.js";
import { clearWarnings, totalWarnings } from "../modules/warningStore.js";
import { setGuildLock } from "../modules/lockdown.js";
import { warnMember } from "../modules/warnAction.js";
import { dmAction } from "../modules/dmNotice.js";
import {
  getLogs,
  logEmitter,
  type LogCategory,
  type LogEntry,
  type LogLevel,
} from "../store/logStore.js";
import {
  createSession,
  destroySession,
  resolveSession,
  SESSION_TTL_MS,
} from "../auth/session.js";
import {
  addUser,
  listUsers,
  removeUser,
  userExists,
  verifyPassword,
} from "../auth/users.js";
import { getSettings, updateSettings } from "../store/settingsStore.js";
import { logEvent } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const COOKIE_NAME = "sid";

function cookieOptions() {
  return {
    httpOnly: true, // JS ฝั่ง browser อ่าน cookie นี้ไม่ได้ (กัน XSS ขโมย)
    secure: config.web.cookieSecure, // ส่งเฉพาะผ่าน HTTPS (เปิดใน production)
    sameSite: "lax" as const, // กัน CSRF ข้ามเว็บ
    path: "/",
  };
}

// ---- กัน brute-force หน้า login (นับต่อ IP) ----
const loginTracker = new Map<string, { fails: number; lockedUntil: number }>();

/** คืนจำนวนนาทีที่ยังถูกล็อก (0 = ไม่ถูกล็อก) */
function loginLockedMinutes(ip: string): number {
  const rec = loginTracker.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    return Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
  }
  return 0;
}

/** คืน true ถ้าการพลาดครั้งนี้ทำให้ถูกล็อก */
function loginFail(ip: string): boolean {
  const rec = loginTracker.get(ip) ?? { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  let locked = false;
  if (rec.fails >= config.web.loginMaxAttempts) {
    rec.lockedUntil = Date.now() + config.web.loginLockMs;
    rec.fails = 0; // เริ่มนับใหม่หลังครบกำหนดล็อก
    locked = true;
  }
  loginTracker.set(ip, rec);
  return locked;
}

function loginReset(ip: string): void {
  loginTracker.delete(ip);
}

// เคลียร์ rate-limit record ที่หมดอายุทุก 1 ชม. กัน memory โต
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, r] of loginTracker) {
      if (r.lockedUntil < now && r.fails === 0) loginTracker.delete(ip);
    }
  },
  60 * 60 * 1000,
).unref();

/** อ่าน cookie จาก header แบบไม่ต้องลง cookie-parser */
function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * คืน username ถ้า request นี้ login แล้ว "และ" บัญชียังอยู่ในรายชื่อที่อนุญาต
 * (เช็ค userExists ทุกครั้ง → ลบ user เมื่อไหร่ session เดิมหลุดทันที)
 */
function authUser(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const username = resolveSession(cookies[COOKIE_NAME]);
  if (!username) return null;
  if (!userExists(username)) return null;
  return username;
}

export function startWebServer(client?: Client): Server | undefined {
  if (!config.web.enabled) return undefined;
  if (!process.env.SESSION_SECRET) {
    console.error(
      "⚠️  ไม่พบ SESSION_SECRET ใน .env — ปิด dashboard ไว้ก่อนเพื่อความปลอดภัย\n" +
        "   สร้างด้วย:  openssl rand -hex 32   แล้วใส่ใน .env",
    );
    return undefined;
  }

  const app = express();
  // เชื่อ X-Forwarded-For เฉพาะจาก proxy จำนวนชั้นที่กำหนด (config.web.trustProxy)
  // ไม่ใช้ true เพราะจะเชื่อค่าที่ client ปลอมได้ → req.ip ปลอมได้ → หลบการล็อก IP ตอน brute-force
  app.set("trust proxy", config.web.trustProxy);
  app.disable("x-powered-by"); // ไม่บอกว่าใช้ Express (กันสแกนหาช่องโหว่)

  // security headers — กัน clickjacking / sniffing / XSS
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    );
    next();
  });

  app.use(express.urlencoded({ extended: false, limit: "16kb" })); // อ่านฟอร์ม + จำกัดขนาดกัน payload ใหญ่
  app.use(express.json({ limit: "16kb" })); // อ่าน JSON body ของ action endpoints

  // ---- ป้องกัน CSRF (ชั้นที่สองเสริม SameSite=lax) ----
  // ทุก request ที่เปลี่ยนสถานะ (POST/PUT/PATCH/DELETE) ต้องมาจาก origin เดียวกัน
  // เช็คจาก Origin ก่อน ถ้าไม่มีค่อยดู Referer — ถ้า host ไม่ตรง = ปฏิเสธ
  // (cross-site fetch ของเบราว์เซอร์จะแนบ Origin เสมอ จึงบล็อกได้; เครื่องมือ non-browser ที่ไม่มี header ทั้งคู่ปล่อยผ่าน)
  const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const source = req.headers.origin || req.headers.referer;
    if (source) {
      let sourceHost: string | null = null;
      try {
        sourceHost = new URL(source).host;
      } catch {
        /* header เพี้ยน */
      }
      if (sourceHost !== req.headers.host) {
        res.status(403).json({ error: "cross-site request blocked" });
        return;
      }
    }
    next();
  });

  // ---------- เส้นทางสาธารณะ (ไม่ต้อง login) ----------
  // ไอคอน/โลโก้ — ต้องเข้าถึงได้ก่อน login (หน้า login ก็ใช้รูปนี้)
  app.get("/icon.svg", (_req: Request, res: Response) => {
    res.sendFile(join(publicDir, "icon.svg"));
  });

  app.get("/login", (_req: Request, res: Response) => {
    res.sendFile(join(publicDir, "login.html"));
  });

  app.post("/login", async (req: Request, res: Response) => {
    const ip = req.ip ?? "?";
    const locked = loginLockedMinutes(ip);
    if (locked > 0) {
      res.redirect(`/login?locked=${locked}`);
      return;
    }
    const username = String(req.body?.username ?? "");
    const password = String(req.body?.password ?? "");
    if (username && password && (await verifyPassword(username, password))) {
      loginReset(ip);
      const token = createSession(username);
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
    } else {
      const locked = loginFail(ip);
      res.redirect(`/login?${locked ? "locked=" + Math.ceil(config.web.loginLockMs / 60000) : "error=1"}`);
      if (locked && client) {
        // ล็อก IP เพราะลองผิดหลายครั้ง = น่าจะมีคนพยายามเจาะ
        void logEvent(client, "alert", "system", "system_login", "🚨 ล็อก IP — login ผิดหลายครั้ง", [
          { name: "IP", value: ip },
          { name: "ลองชื่อ", value: username || "(ว่าง)" },
        ]);
      }
    }
  });

  app.post("/logout", (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    destroySession(cookies[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, cookieOptions());
    res.redirect("/login");
  });

  // ---------- ด่านตรวจ: ทุกอย่างหลังจากนี้ต้อง login ----------
  app.use((req: Request, res: Response, next: NextFunction) => {
    const username = authUser(req);
    if (!username) {
      if (req.path.startsWith("/api")) {
        res.status(401).json({ error: "unauthorized" });
      } else {
        res.redirect("/login");
      }
      return;
    }
    res.locals.username = username;
    next();
  });

  // ---------- เส้นทางที่ต้อง login ----------
  app.get("/api/me", (_req: Request, res: Response) => {
    res.json({ username: res.locals.username });
  });

  // สถิติภาพรวมสำหรับหน้า Overview
  app.get("/api/stats", async (_req: Request, res: Response) => {
    const logs = getLogs();
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const byLevel: Record<string, number> = { info: 0, warn: 0, alert: 0 };
    const byCat: Record<string, number> = {
      security: 0,
      member: 0,
      voice: 0,
      audit: 0,
      system: 0,
    };
    const perHour = new Array(24).fill(0); // ดัชนี 23 = ชั่วโมงล่าสุด
    let today = 0;
    const alerts: LogEntry[] = [];
    for (const e of logs) {
      byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
      const c = e.category || "system";
      byCat[c] = (byCat[c] ?? 0) + 1;
      if (e.timestamp >= dayAgo) {
        today++;
        const hoursAgo = Math.floor((now - e.timestamp) / 3_600_000);
        if (hoursAgo >= 0 && hoursAgo < 24) perHour[23 - hoursAgo]++;
      }
      if (e.level === "alert" && alerts.length < 6) alerts.push(e);
    }

    // คนในห้องเสียงตอนนี้ + ดึงชื่อ (มีไม่กี่คน)
    const voice = getVoiceStates();
    const inVoice = await Promise.all(
      voice.slice(0, 25).map(async (v) => {
        let username = v.userId;
        try {
          if (client) username = (await client.users.fetch(v.userId)).username;
        } catch {
          /* ดึงชื่อไม่ได้ */
        }
        return {
          username,
          channel: v.channelName,
          muted: v.selfMute || v.serverMute,
          deaf: v.selfDeaf || v.serverDeaf,
        };
      }),
    );

    res.json({
      bufferedLogs: logs.length,
      today,
      byLevel,
      byCat,
      perHour,
      members: listMembers().length,
      warnings: totalWarnings(),
      inVoiceCount: voice.length,
      inVoice,
      alerts,
    });
  });

  // รายชื่อสมาชิก + สถานะเสียงปัจจุบัน (ไมค์/หูฟัง/ห้องที่อยู่)
  app.get("/api/members", async (_req: Request, res: Response) => {
    const members = listMembers();
    const result = await Promise.all(
      members.map(async (m) => {
        let username = m.id;
        try {
          if (client) username = (await client.users.fetch(m.id)).username;
        } catch {
          // ดึง user ไม่ได้ (ออกจากเซิร์ฟเวอร์?) — ใช้ id แทน
        }
        return {
          ...m,
          username,
          voice: getVoiceState(m.id),
          level: getActivity(m.id).level,
        };
      }),
    );
    res.json(result);
  });

  // รูปบัตรของสมาชิกคนนั้น (สร้างสด ๆ จาก avatar + ข้อมูล)
  app.get("/api/members/:id/card.png", async (req: Request, res: Response) => {
    const id = req.params.id;
    const card = id ? getMember(id) : null;
    if (!id || !card || !client) {
      res.status(404).send("not found");
      return;
    }
    try {
      const user = await client.users.fetch(id);
      const buf = await getCardImage(
        user.id,
        user.username,
        user.displayAvatarURL({ extension: "png", size: 256 }),
        card,
      );
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-cache");
      res.send(buf);
    } catch {
      res.status(500).send("card error");
    }
  });

  // ---------- Activity / XP ----------
  // เติมชื่อผู้ใช้จาก Discord ให้ activity (best-effort)
  async function withName(a: Activity) {
    let username = a.userId;
    try {
      if (client) username = (await client.users.fetch(a.userId)).username;
    } catch {
      /* ดึงชื่อไม่ได้ */
    }
    return { ...a, username, ...levelProgress(a.xp) };
  }

  // XP/เลเวล/สถิติของคนคนนั้น (สำหรับหน้าโปรไฟล์)
  app.get("/api/activity/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!id) {
      res.status(400).json({ error: "missing id" });
      return;
    }
    res.json(await withName(getActivity(id)));
  });

  // อันดับ — ?by=xp|voice&limit=n (สำหรับ leaderboard)
  app.get("/api/leaderboard", async (req: Request, res: Response) => {
    const by = req.query.by === "voice" ? "voice" : "xp";
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const rows = by === "voice" ? topByVoice(limit) : topByXp(limit);
    res.json({ by, entries: await Promise.all(rows.map(withName)) });
  });

  // ---------- ปฏิบัติการจาก dashboard (ban/kick/timeout/warn/lock) ----------
  const getGuild = (): Guild | null => {
    if (!client) return null;
    const gid = process.env.GUILD_ID;
    return (
      (gid ? client.guilds.cache.get(gid) : null) ??
      client.guilds.cache.first() ??
      null
    );
  };

  async function runMemberAction(
    req: Request,
    res: Response,
    type: "ban" | "kick" | "timeout" | "untimeout" | "warn",
  ): Promise<void> {
    const guild = getGuild();
    const userId = String(req.body?.userId ?? "");
    const reason = String(req.body?.reason || "ดำเนินการจาก dashboard");
    const actor = String(res.locals.username);
    if (!guild || !userId) {
      res.status(400).json({ ok: false, message: "ข้อมูลไม่ครบ" });
      return;
    }
    try {
      let msg = "";
      let level: LogLevel = "warn";
      let category: LogCategory = "audit";
      let event = "audit_member";

      // หาสมาชิก (เผื่อ DM ก่อนลงโทษ) — อาจไม่อยู่ในเซิร์ฟเวอร์แล้ว
      const member = await guild.members.fetch(userId).catch(() => null);
      const dmTag = (sent: boolean) => (member ? (sent ? "📨 DM แล้ว" : "(DM ไม่ได้)") : "");

      if (type === "ban") {
        const sent = member ? await dmAction(member, "ban", reason) : false;
        if (member) await member.ban({ reason });
        else await guild.members.ban(userId, { reason });
        msg = `แบนแล้ว ${dmTag(sent)}`.trim();
        level = "alert";
        event = "audit_ban";
      } else if (!member) {
        res.status(404).json({ ok: false, message: "ไม่พบสมาชิกในเซิร์ฟเวอร์" });
        return;
      } else if (type === "kick") {
        const sent = await dmAction(member, "kick", reason);
        await member.kick(reason);
        msg = `เตะออกแล้ว ${dmTag(sent)}`.trim();
        event = "audit_kick";
      } else if (type === "timeout") {
        const min = Number(req.body?.minutes) || 60;
        const sent = await dmAction(member, "timeout", reason, min * 60_000);
        await member.timeout(min * 60_000, reason);
        msg = `timeout ${min} นาที ${dmTag(sent)}`.trim();
        event = "audit_timeout";
      } else if (type === "untimeout") {
        await member.timeout(null, reason);
        msg = "ปลด timeout แล้ว";
        level = "info";
        event = "audit_timeout";
      } else {
        // warn
        const r = await warnMember(member, "dashboard", actor, reason);
        msg = `เตือนแล้ว (ครั้งที่ ${r.count}) ${r.actionMsg} ${r.dmSent ? "📨 DM แล้ว" : "(DM ไม่ได้)"}`.trim();
        level = r.level;
        category = "security";
        event = "security_warn";
      }

      res.json({ ok: true, message: msg });
      if (client) {
        await logEvent(client, level, category, event, `${msg} (จาก dashboard)`, [
          { name: "เป้าหมาย", value: userId },
          { name: "โดย (dashboard)", value: actor },
          { name: "เหตุผล", value: reason },
        ]);
      }
    } catch {
      res
        .status(500)
        .json({ ok: false, message: "ทำไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)" });
    }
  }

  app.post("/api/action/ban", (req, res) => runMemberAction(req, res, "ban"));
  app.post("/api/action/kick", (req, res) => runMemberAction(req, res, "kick"));
  app.post("/api/action/timeout", (req, res) => runMemberAction(req, res, "timeout"));
  app.post("/api/action/untimeout", (req, res) => runMemberAction(req, res, "untimeout"));
  app.post("/api/action/warn", (req, res) => runMemberAction(req, res, "warn"));

  app.post("/api/action/clearwarnings", async (req: Request, res: Response) => {
    const userId = String(req.body?.userId ?? "");
    const actor = String(res.locals.username);
    if (!userId) {
      res.status(400).json({ ok: false, message: "ข้อมูลไม่ครบ" });
      return;
    }
    const n = clearWarnings(userId);
    res.json({ ok: true, message: n ? `ล้างเตือน ${n} ครั้ง` : "ไม่มีเตือนให้ลบ" });
    if (n && client) {
      await logEvent(client, "info", "security", "security_warn", "ล้างเตือน (จาก dashboard)", [
        { name: "เป้าหมาย", value: userId },
        { name: "โดย (dashboard)", value: actor },
        { name: "ลบ", value: `${n} ครั้ง` },
      ]);
    }
  });

  async function lockGuild(allow: boolean, actor: string) {
    const guild = getGuild();
    if (!guild) return { ok: false, message: "ไม่พบเซิร์ฟเวอร์" };
    const { ok, fail } = await setGuildLock(guild, !allow);
    if (client) {
      await logEvent(
        client,
        allow ? "info" : "alert",
        "system",
        "system_lock",
        `${allow ? "ปลดล็อก" : "ล็อก"}เซิร์ฟเวอร์ (จาก dashboard)`,
        [
          { name: "โดย (dashboard)", value: actor },
          { name: "ห้องสำเร็จ", value: `${ok}` },
        ],
      );
    }
    return { ok: true, message: `${allow ? "ปลดล็อก" : "ล็อก"} ${ok} ห้อง${fail ? ` (พลาด ${fail})` : ""}` };
  }
  app.post("/api/action/lock", async (_req, res) => {
    res.json(await lockGuild(false, String(res.locals.username)));
  });
  app.post("/api/action/unlock", async (_req, res) => {
    res.json(await lockGuild(true, String(res.locals.username)));
  });

  // ---------- Settings ----------
  app.get("/api/settings", (_req: Request, res: Response) => {
    res.json(getSettings());
  });
  app.post("/api/settings", async (req: Request, res: Response) => {
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ ok: false, message: "ข้อมูลไม่ถูกต้อง" });
      return;
    }
    updateSettings(req.body as Record<string, unknown>);
    res.json({ ok: true, message: "บันทึกการตั้งค่าแล้ว" });
    if (client) {
      await logEvent(client, "warn", "system", "system_settings", "แก้ไขการตั้งค่า (จาก dashboard)", [
        { name: "โดย", value: String(res.locals.username) },
      ]);
    }
  });

  // ---------- จัดการบัญชี mod ----------
  app.get("/api/users", (_req: Request, res: Response) => {
    res.json(listUsers());
  });
  app.post("/api/users/add", async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    // จำกัดรูปแบบ username: a-z A-Z 0-9 _ . - ยาว 3–32 ตัว
    // กัน stored XSS (เช่นชื่อที่มี ' " < >) ที่จะถูกฝังในหน้า dashboard
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
      res.status(400).json({
        ok: false,
        message: "username 3–32 ตัว (a-z 0-9 _ . -) + รหัสผ่าน ≥ 8 ตัว",
      });
      return;
    }
    try {
      await addUser(username, password);
      res.json({ ok: true, message: `เพิ่มบัญชี ${username} แล้ว` });
      if (client) {
        await logEvent(client, "warn", "system", "system_settings", "เพิ่มบัญชี mod (จาก dashboard)", [
          { name: "บัญชีใหม่", value: username },
          { name: "โดย", value: String(res.locals.username) },
        ]);
      }
    } catch {
      res.status(400).json({ ok: false, message: "มีบัญชีนี้อยู่แล้ว" });
    }
  });
  app.post("/api/users/remove", async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "");
    if (listUsers().length <= 1) {
      res.status(400).json({ ok: false, message: "ลบไม่ได้ — ต้องเหลือบัญชีอย่างน้อย 1" });
      return;
    }
    const ok = removeUser(username);
    res.json({ ok, message: ok ? `ลบบัญชี ${username} แล้ว` : "ไม่พบบัญชีนี้" });
    if (ok && client) {
      await logEvent(client, "alert", "system", "system_settings", "ลบบัญชี mod (จาก dashboard)", [
        { name: "บัญชีที่ลบ", value: username },
        { name: "โดย", value: String(res.locals.username) },
      ]);
    }
  });

  app.get("/api/logs", (req: Request, res: Response) => {
    const level = req.query.level as LogLevel | undefined;
    const category = req.query.category as LogCategory | undefined;
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(getLogs({ level, category, search, limit }));
  });

  app.get("/api/stream", (req: Request, res: Response) => {
    const username = res.locals.username as string;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");

    const onLog = (entry: LogEntry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };
    logEmitter.on("log", onLog);

    // ทุก 15 วิ: ส่ง ping กันหลุด + เช็คว่าบัญชียังอยู่ไหม (ถูกลบ → ปิด stream)
    const tick = setInterval(() => {
      if (!userExists(username)) {
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

  // หน้า dashboard + ไฟล์ static (ถูกป้องกันด้วยด่านตรวจด้านบนแล้ว)
  app.use(express.static(publicDir));

  return app.listen(config.web.port, config.web.host, () => {
    console.log(
      `🌐 Dashboard: http://${config.web.host}:${config.web.port}/ (ต้อง login)`,
    );
  });
}
