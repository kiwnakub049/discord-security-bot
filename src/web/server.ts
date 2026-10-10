/**
 * ตัวประกอบร่างของเว็บ — ไฟล์นี้ไม่มีตรรกะทางธุรกิจเลย
 * มีแค่ "ลำดับ" ของ middleware กับ router ซึ่งเป็นเรื่องที่ผิดพลาดง่ายที่สุด
 * เลยจงใจให้อ่านจบได้ในหน้าจอเดียว
 *
 * ลำดับสำคัญ:
 *   security headers → CSRF → body parser → เส้นทางสาธารณะ → ด่าน login → ที่เหลือ
 * ถ้าเอาด่าน login ขึ้นก่อนเส้นทางสาธารณะ จะ login ไม่ได้เลยเพราะโดนเด้งวนหน้า /login
 */
import express, { type Request, type Response } from "express";
import type { Client } from "discord.js";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { csrfGuard, securityHeaders } from "./middleware/security.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { requireAuth } from "./middleware/auth.js";
import { notifySecurity } from "../modules/securityAlerts.js";
import { meRoutes, publicAuthRoutes } from "./routes/auth.js";
import { overviewRoutes } from "./routes/overview.js";
import { systemRoutes } from "./routes/system.js";
import { logRoutes } from "./routes/logs.js";
import { memberRoutes } from "./routes/members.js";
import { actionRoutes } from "./routes/actions.js";
import { adminRoutes } from "./routes/admin.js";
import { sessionRoutes } from "./routes/sessions.js";
import { aiRoutes } from "./routes/ai.js";
import { queueRoutes } from "./routes/queue.js";
import { beammpRoutes } from "./routes/beammp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** ไฟล์ที่ต้องเข้าถึงได้ก่อน login (หน้า login ก็ใช้) */
const publicDir = join(__dirname, "public");
/** หน้าเว็บที่ Vite build แล้ว — ต้อง login ก่อนถึงจะเห็น */
const uiDir = join(__dirname, "ui", "dist");

export function startWebServer(client?: Client): Server | undefined {
  if (!config.web.enabled) return undefined;
  if (!process.env.SESSION_SECRET) {
    console.error(
      "⚠️  ไม่พบ SESSION_SECRET ใน .env — ปิด dashboard ไว้ก่อนเพื่อความปลอดภัย\n" +
        "   สร้างด้วย:  openssl rand -hex 32   แล้วใส่ใน .env",
    );
    return undefined;
  }
  if (!existsSync(join(uiDir, "index.html"))) {
    console.error(
      "⚠️  ยังไม่ได้ build หน้าเว็บ — dashboard จะขึ้นหน้าว่าง\n" +
        "   สั่ง:  npm run build:ui",
    );
  }

  const app = express();
  // เชื่อ X-Forwarded-For เฉพาะจาก proxy จำนวนชั้นที่กำหนด (config.web.trustProxy)
  // ไม่ใช้ true เพราะจะเชื่อค่าที่ client ปลอมได้ → req.ip ปลอมได้ → หลบการล็อก IP ตอน brute-force
  app.set("trust proxy", config.web.trustProxy);
  app.disable("x-powered-by"); // ไม่บอกว่าใช้ Express (กันสแกนหาช่องโหว่)

  app.use(securityHeaders);
  // ปฏิเสธคำขอข้ามเว็บ "ก่อน" อ่าน body — ไม่มีเหตุผลให้เสียแรงแกะ JSON 16kb
  // ของคำขอที่จะโดนตีกลับอยู่ดี
  app.use(csrfGuard);
  app.use(express.urlencoded({ extended: false, limit: "16kb" })); // ฟอร์ม login
  app.use(express.json({ limit: "16kb" })); // body ของ API

  // ---------- rate limit (กัน botnet ยิงถล่ม) ----------
  // /login: backstop เหนือ lockout (5 ครั้ง/15 นาที) — จับการยิงรัวก่อนเสียแรง scrypt
  // เพดาน 20 สูงกว่า lockout จงใจ: lockout คือตัวคุมหลัก อันนี้กันน้ำท่วมเฉย ๆ
  app.post(
    "/login",
    rateLimit("login", 20, 15 * 60_000, (ip) =>
      void notifySecurity("rate limit /login", `IP ${ip} ยิง POST /login เกิน 20 ครั้ง/15 นาที`),
    ),
  );
  // API ทั้งหมด: 240 ครั้ง/นาที/IP — ยกเว้น /api/stream (SSE เชื่อมต่อยาว 1 ครั้ง
  // แต่ตอน deploy/เน็ตสะดุด client จะ reconnect วน ถ้านับรวมจะเผาโควตาตัวเอง)
  const apiLimiter = rateLimit("api", 240, 60_000, (ip) =>
    void notifySecurity("rate limit API", `IP ${ip} ยิง API เกิน 240 ครั้ง/นาที`),
  );
  app.use("/api", (req: Request, res: Response, next) => {
    if (req.path === "/stream") return next();
    apiLimiter(req, res, next);
  });
  // export CSV แพงสุด (query 5000 แถว) — โควตาแยกเข้มกว่า
  app.get("/api/logs/export.csv", rateLimit("export", 10, 5 * 60_000));

  // ---------- ก่อน login ----------
  app.get("/icon.svg", (_req: Request, res: Response) => {
    res.sendFile(join(publicDir, "icon.svg"));
  });
  app.use(publicAuthRoutes(client));

  // ---------- ด่านตรวจ ----------
  app.use(requireAuth);

  // ---------- หลัง login ----------
  app.use(meRoutes(client));
  app.use(overviewRoutes(client));
  app.use(queueRoutes(client));
  app.use(systemRoutes());
  app.use(logRoutes());
  app.use(memberRoutes(client));
  app.use(actionRoutes(client));
  app.use(adminRoutes(client));
  app.use(sessionRoutes(client));
  app.use(aiRoutes());
  app.use(beammpRoutes(client)); // เห็นเฉพาะเจ้าของเครื่อง (requireOwner อยู่ในนั้น)

  // API ที่ไม่มีจริง ต้องได้ 404 เป็น JSON — ไม่ใช่ index.html ของหน้าเว็บ
  // ไม่งั้นฝั่ง client จะพยายาม JSON.parse หน้า HTML แล้วพังด้วย error ที่อ่านไม่รู้เรื่อง
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });

  // ---------- หน้าเว็บ ----------
  // ไฟล์ที่มี hash ในชื่อ (assets/*.js, *.css ของ Vite) เปลี่ยนชื่อทุกครั้งที่ build
  // เลย cache ยาวได้ปลอดภัย ส่วน index.html ต้องไม่ cache ไม่งั้นจะชี้ไปไฟล์เก่าที่ลบไปแล้ว
  app.use(
    express.static(uiDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // ทุก path ที่เหลือคืน index.html — router ฝั่งหน้าเว็บจัดการเอง (กดรีเฟรชกลางทางแล้วไม่ 404)
  app.use((_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(uiDir, "index.html"));
  });

  return app.listen(config.web.port, config.web.host, () => {
    console.log(
      `🌐 Dashboard: http://${config.web.host}:${config.web.port}/ (ต้อง login)`,
    );
  });
}
