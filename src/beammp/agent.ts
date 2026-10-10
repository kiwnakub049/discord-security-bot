import "dotenv/config"; // ต้องมาก่อน import อื่น — โทเคนถูกอ่านตอนโหลดโมดูล
import express, { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { AGENT_PORT, paths } from "./paths.js";
import { Supervisor } from "./supervisor.js";
import { applyPatch, parseConfig, publicValues, readConfigFile } from "./serverConfig.js";
import { FIELDS, MAPS } from "./fields.js";
import { deleteMod, levelsInMod, listMods, looksLikeZip, MAX_MOD_BYTES, tooBigMessage } from "./mods.js";
import {
  abortUpload,
  beginUpload,
  CHUNK_BYTES,
  finishUpload,
  safeUnlink,
  writeChunk,
} from "./uploads.js";
import { renameSync } from "node:fs";
import { joinAddresses } from "./addresses.js";
import { join } from "node:path";

/**
 * agent คุมเซิร์ฟเวอร์ BeamMP — ฟังเฉพาะ 127.0.0.1 เหมือน toxic-serve
 *
 * แยกออกมาจาก dashboard เพราะ service ของบอทถูกล็อกไว้ (NoNewPrivileges + ProtectHome)
 * จนแตะโฟลเดอร์เกมไม่ได้ ดูเหตุผลเต็มใน supervisor.ts
 *
 * ตัวนี้ไม่มีระบบผู้ใช้ — ใครยิงถึงก็สั่งได้ จึงต้อง (1) ฟังแค่ loopback
 * และ (2) ต้องมีโทเคนที่ตรงกับที่ dashboard ถือ กันโปรเซสอื่นบนเครื่องมาสั่งเล่น
 */

const TOKEN = process.env.BEAMMP_AGENT_TOKEN ?? "";
if (TOKEN.length < 16) {
  console.error("❌ ต้องตั้ง BEAMMP_AGENT_TOKEN (อย่างน้อย 16 ตัวอักษร) ใน .env ก่อน");
  process.exit(78); // 78 = ตั้งค่าผิด — systemd ตั้งไม่ให้รีสตาร์ทวนที่โค้ดนี้
}

const sup = new Supervisor();
const app = express();
app.disable("x-powered-by");

/** เทียบโทเคนแบบไม่รั่วเวลา — กันเดาทีละตัวอักษรจากเวลาที่ตอบกลับ */
function tokenOk(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const given = req.get("x-agent-token") ?? "";
  if (!tokenOk(given)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

app.use(express.json({ limit: "64kb" }));

/* ── สถานะ + ผู้เล่น ── */
app.get("/status", (_req, res) => {
  /*
   * ส่งพอร์ตกับที่อยู่ไปด้วย เพื่อให้หน้าเว็บและคำสั่งใน Discord โชว์วิธีเข้าเล่นได้
   * โดยไม่ต้องมีใครจำ IP เอง (IP ในวง LAN มาจาก DHCP เปลี่ยนได้ตลอด)
   */
  let port = 30814;
  try {
    const v = parseConfig(readConfigFile(paths.config)).values.get("General")?.get("Port");
    if (typeof v === "number") port = v;
  } catch {
    // ไม่มีไฟล์ตั้งค่า — ใช้พอร์ตมาตรฐานไปก่อน
  }
  res.json({
    ...sup.status(),
    players: sup.players(),
    port,
    addresses: joinAddresses(),
  });
});

/* ── สั่งเปิด/ปิด/รีสตาร์ท ── */
app.post("/start", (_req, res) => {
  const r = sup.start();
  res.status(r.ok ? 200 : 409).json(r);
});

app.post("/stop", async (_req, res) => {
  const r = await sup.stop();
  res.status(r.ok ? 200 : 409).json(r);
});

app.post("/restart", async (_req, res) => {
  const r = await sup.restart();
  res.status(r.ok ? 200 : 409).json(r);
});

/* ── ตั้งค่า ── */
app.get("/config", (_req, res) => {
  try {
    const text = readConfigFile(paths.config);
    res.json({ values: publicValues(text), fields: FIELDS, maps: MAPS });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "อ่านไฟล์ตั้งค่าไม่ได้" });
  }
});

app.put("/config", (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (typeof body !== "object" || body === null) {
    res.status(400).json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" });
    return;
  }
  try {
    const r = applyPatch(paths.config, body);
    if (!r.ok) {
      res.status(400).json({ error: r.errors.join(" · ") });
      return;
    }
    res.json({ ok: true, applied: r.applied, needsRestart: sup.status().state === "running" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "เขียนไฟล์ไม่ได้" });
  }
});

/* ── log ── */
app.get("/logs", (_req, res) => {
  res.json({ lines: sup.recentLogs() });
});

app.get("/logs/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send("hello", { lines: sup.recentLogs(), status: sup.status() });
  const onLog = (line: unknown) => send("log", line);
  const onStatus = (s: unknown) => send("status", s);
  sup.on("log", onLog);
  sup.on("status", onStatus);
  // กันตัวกลาง (proxy/เบราว์เซอร์) ตัดการเชื่อมต่อตอนเงียบนาน ๆ
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    sup.off("log", onLog);
    sup.off("status", onStatus);
  });
});

/* ── ม็อด ── */
app.get("/mods", async (_req, res) => {
  res.json({ mods: await listMods(), maxBytes: MAX_MOD_BYTES, chunkBytes: CHUNK_BYTES });
});

/*
 * อัปโหลดแบบซอยเป็นก้อน — begin แล้ว chunk ทีละก้อน แล้ว finish
 *
 * ทำไมไม่รับรวดเดียว: เว็บวิ่งผ่าน Cloudflare Tunnel ที่จำกัด body 100 MiB ต่อคำขอ
 * ดูรายละเอียดใน uploads.ts
 */
app.post("/mods/begin", (req, res) => {
  const name = String((req.body as { name?: unknown })?.name ?? "");
  const r = beginUpload(name);
  res.status(r.ok ? 200 : 400).json(r);
});

app.put("/mods/chunk", async (req, res) => {
  const id = String(req.query.id ?? "");
  const offset = Number(req.query.offset ?? NaN);
  if (!Number.isInteger(offset) || offset < 0) {
    res.status(400).json({ ok: false, error: "offset ไม่ถูกต้อง" });
    return;
  }
  const declared = Number(req.get("content-length"));
  const r = await writeChunk(
    id,
    offset,
    req,
    Number.isFinite(declared) ? declared : undefined,
  );
  res.status(r.ok ? 200 : 400).json(r);
});

app.post("/mods/finish", async (req, res) => {
  const id = String((req.body as { id?: unknown })?.id ?? "");
  const r = finishUpload(id);
  if (!r.ok) {
    res.status(400).json(r);
    return;
  }
  // ตรวจว่าเป็น zip จริงหลังต่อครบทุกก้อนแล้ว — ก้อนแรกอย่างเดียวบอกไม่ได้ว่าไฟล์ครบ
  if (!looksLikeZip(r.partPath)) {
    safeUnlink(r.partPath);
    res.status(400).json({ ok: false, error: "ไฟล์นี้ไม่ใช่ zip" });
    return;
  }
  const finalPath = join(paths.mods, r.name);
  renameSync(r.partPath, finalPath);
  res.json({
    ok: true,
    name: r.name,
    levels: await levelsInMod(finalPath),
    needsRestart: sup.status().state === "running",
  });
});

app.post("/mods/abort", (req, res) => {
  abortUpload(String((req.body as { id?: unknown })?.id ?? ""));
  res.json({ ok: true });
});

/** แผนที่ทั้งหมดที่ติดตั้งไว้ — เอาไว้ให้หน้าตั้งค่าเลือกได้โดยไม่ต้องพิมพ์ path เอง */
app.get("/levels", async (_req, res) => {
  const found = new Map<string, string>(); // path -> ชื่อไฟล์ม็อดที่มันอยู่
  for (const m of await listMods()) {
    for (const lv of await levelsInMod(join(paths.mods, m.name))) {
      if (!found.has(lv)) found.set(lv, m.name);
    }
  }
  res.json({
    levels: [...found].map(([value, from]) => ({ value, from })),
  });
});

app.delete("/mods", (req, res) => {
  const r = deleteMod(String(req.query.name ?? ""));
  res.status(r.ok ? 200 : 400).json(r);
});

app.listen(AGENT_PORT, "127.0.0.1", () => {
  console.log(`🚗 BeamMP agent: http://127.0.0.1:${AGENT_PORT} (โฟลเดอร์เกม: ${paths.dir})`);
  sup.resumeIfWanted();
});

/* ปิดเซิร์ฟเกมให้เรียบร้อยเมื่อ agent ถูกสั่งหยุด — ไม่ทิ้งโปรเซสค้าง */
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    // stop(false) = ไม่จำว่า "ผู้ใช้สั่งปิด" เพราะนี่คือ agent ปิดตัวเอง
    void sup.stop(false).finally(() => process.exit(0));
  });
}
