/**
 * แชททีม — admin/mod คุยกันบน dashboard: ห้องรวม + คุยส่วนตัว, ส่งไฟล์/รูป, แท็กกันได้
 * ทุกเส้นอยู่หลัง requireAuth (ทุกคนที่เข้า dashboard ได้คือทีม)
 */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AccessResolver } from "../../auth/access.js";
import { listStaff, notifyMentions } from "../../modules/teamChat.js";
import {
  GENERAL,
  addFile,
  addMessage,
  canAccessRoom,
  dmMembers,
  filePath,
  getFile,
  getReplyTarget,
  isSnowflake,
  listMessages,
  markRead,
  newFileId,
  roomSummaries,
} from "../../store/teamChatStore.js";
import { rateLimit } from "../middleware/rateLimit.js";

/** ต่อไฟล์ — ต่ำกว่าเพดาน 100 MiB ต่อคำขอของ Cloudflare เลยส่งรวดเดียวได้ */
export const MAX_FILE_BYTES = 100_000_000;
const MAX_FILES_PER_MESSAGE = 10;
const BODY_MAX = 4000;
/** @all ในห้องรวมแท็กได้ทั้งทีม — เผื่อทีมใหญ่ */
const MAX_MENTIONS = 100;
/** แท็กทุกคนในห้อง — ต้องตรงกับ ALL_RE ใน ui/src/pages/Team.tsx */
export const ALL_RE = /(^|\s)@all(?=\s|$)/i;

/**
 * ชนิดไฟล์ที่ให้เปิดดูในหน้าเว็บได้เลย (รูป/วิดีโอ/เสียง) — อย่างอื่นบังคับดาวน์โหลด
 * กันไฟล์ HTML/SVG ที่แอบใส่สคริปต์ถูกเปิดบนโดเมนเราแล้วขโมย session
 * (SVG ไม่อยู่ในนี้ด้วยเหตุผลเดียวกัน)
 */
const INLINE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);

/** ชื่อไฟล์จากผู้ใช้ — ตัดตัวควบคุม/ทางเดิน path ทิ้ง เหลือแค่ชื่อไว้โชว์ */
function cleanName(raw: unknown): string {
  const name = String(raw ?? "")
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return name || "file";
}

function cleanMime(raw: unknown): string {
  const m = String(raw ?? "").toLowerCase().split(";")[0]!.trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(m) ? m : "application/octet-stream";
}

export function teamRoutes(client: Client | undefined, access: AccessResolver): Router {
  const r = Router();
  const me = (res: Response) => String(res.locals.userId);

  /** ห้องนี้ใช้ได้ไหม — DM ต้องเป็นของเรา และอีกฝ่ายต้องยังเป็นทีมอยู่ */
  async function roomOk(room: unknown, userId: string): Promise<boolean> {
    if (typeof room !== "string" || !canAccessRoom(room, userId)) return false;
    if (room === GENERAL) return true;
    const other = dmMembers(room)!.find((id) => id !== userId)!;
    return (await access(other).catch(() => null)) !== null;
  }

  r.get("/api/team/people", async (_req: Request, res: Response) => {
    res.json(await listStaff(client));
  });

  r.get("/api/team/rooms", (_req: Request, res: Response) => {
    res.json(roomSummaries(me(res)));
  });

  /** จุดแจ้งเตือนบนเมนู — ยังไม่อ่านทั้งหมด + มีคนแท็กไหม */
  r.get("/api/team/unread", (_req: Request, res: Response) => {
    const rooms = roomSummaries(me(res));
    res.json({
      unread: rooms.reduce((n, x) => n + x.unread, 0),
      mentioned: rooms.some((x) => x.mentioned),
    });
  });

  r.get("/api/team/messages", async (req: Request, res: Response) => {
    const room = req.query.room;
    if (typeof room !== "string" || !canAccessRoom(room, me(res))) {
      res.status(404).json({ ok: false, error: "ไม่พบห้องนี้" });
      return;
    }
    const after = Number(req.query.after);
    const before = Number(req.query.before);
    res.json(
      listMessages(room, {
        ...(Number.isInteger(after) && after >= 0 && req.query.after !== undefined ? { after } : {}),
        ...(Number.isInteger(before) && before > 0 ? { before } : {}),
      }),
    );
  });

  r.post("/api/team/messages", async (req: Request, res: Response) => {
    const userId = me(res);
    const { room, body: rawBody, files: rawFiles, mentions: rawMentions, replyTo: rawReply } = req.body ?? {};
    if (typeof room !== "string" || !(await roomOk(room, userId))) {
      res.status(404).json({ ok: false, error: "ไม่พบห้องนี้" });
      return;
    }
    const body = typeof rawBody === "string" ? rawBody.trim() : "";
    const fileIds = Array.isArray(rawFiles)
      ? [...new Set(rawFiles.filter((f): f is string => typeof f === "string"))]
      : [];
    if (body.length > BODY_MAX || fileIds.length > MAX_FILES_PER_MESSAGE || (!body && !fileIds.length)) {
      res.status(400).json({
        ok: false,
        error: `ข้อความ 1–${BODY_MAX} ตัวอักษร หรือแนบไฟล์ได้ไม่เกิน ${MAX_FILES_PER_MESSAGE} ไฟล์`,
      });
      return;
    }
    // ตอบกลับ: ต้นทางต้องอยู่ห้องเดียวกัน
    let replyTo: number | null = null;
    let replyAuthor: string | null = null;
    if (rawReply !== undefined && rawReply !== null) {
      const target = Number.isInteger(rawReply) ? getReplyTarget(room, rawReply) : undefined;
      if (!target) {
        res.status(400).json({ ok: false, error: "ไม่พบข้อความที่จะตอบกลับ" });
        return;
      }
      replyTo = target.id;
      replyAuthor = target.author_id;
    }
    // @all = ทุกคนในห้อง — server ไล่รายชื่อทีมเองด้วย ไม่พึ่งรายชื่อที่หน้าเว็บส่งมาอย่างเดียว
    const everyone = ALL_RE.test(body) ? (await listStaff(client)).map((p) => p.id) : [];
    // แท็กได้เฉพาะทีมที่เห็นห้องนี้ — ห้อง DM แท็กได้แค่อีกฝ่าย, ไม่แท็กตัวเอง
    // ตอบกลับ = แจ้งเจ้าของข้อความต้นทางด้วย (เหมือน Discord)
    const wanted = [
      ...new Set([
        ...(Array.isArray(rawMentions) ? rawMentions.filter(isSnowflake) : []),
        ...everyone,
        ...(replyAuthor ? [replyAuthor] : []),
      ]),
    ]
      .filter((id) => id !== userId)
      .slice(0, MAX_MENTIONS);
    const mentions: string[] = [];
    for (const id of wanted) {
      if (canAccessRoom(room, id) && (await access(id).catch(() => null))) mentions.push(id);
    }

    const all = everyone.length > 0 || ALL_RE.test(body);
    let msg;
    try {
      msg = addMessage({
        room,
        authorId: userId,
        authorName: String(res.locals.username ?? userId),
        body,
        mentions,
        fileIds,
        replyTo,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "ส่งไม่สำเร็จ" });
      return;
    }
    res.json({ ok: true, message: msg });
    // DM คนที่ถูกแท็กหลังตอบแล้ว — ไม่ให้คนส่งรอ Discord
    void notifyMentions(client, msg, all);
  });

  r.post("/api/team/read", (req: Request, res: Response) => {
    const { room, lastId } = req.body ?? {};
    if (typeof room !== "string" || !canAccessRoom(room, me(res)) || !Number.isInteger(lastId)) {
      res.status(400).json({ ok: false });
      return;
    }
    markRead(me(res), room, lastId);
    res.json({ ok: true });
  });

  /**
   * อัปไฟล์ — body ดิบ (ไม่ใช่ multipart) สตรีมลงดิสก์ตรง ไม่พักในแรม
   * ได้ id กลับไป แล้วค่อยแนบตอนส่งข้อความ (ไฟล์ที่ไม่ได้ส่งภายใน 1 วันถูกลบทิ้ง)
   */
  r.put(
    "/api/team/files",
    rateLimit("team-upload", 60, 10 * 60_000),
    async (req: Request, res: Response) => {
      const declared = Number(req.get("content-length"));
      if (!Number.isFinite(declared) || declared <= 0) {
        res.status(411).json({ ok: false, error: "ไม่รู้ขนาดไฟล์" });
        return;
      }
      if (declared > MAX_FILE_BYTES) {
        res.status(413).json({ ok: false, error: "ไฟล์ใหญ่เกิน 100 MB" });
        return;
      }
      // ยาวนานได้ (ไฟล์ใหญ่บนเน็ตช้า) — ปลดเพดานเวลาของ Node เฉพาะคำขอนี้
      req.setTimeout(30 * 60_000);

      const id = newFileId();
      const dest = filePath(id);
      let bytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          // content-length โกหกได้ — นับจริงอีกชั้น
          if (bytes > MAX_FILE_BYTES) cb(new Error("too large"));
          else cb(null, chunk);
        },
      });
      try {
        await pipeline(req, counter, createWriteStream(dest, { flags: "wx" }));
      } catch {
        await rm(dest, { force: true });
        if (!res.headersSent) res.status(400).json({ ok: false, error: "อัปโหลดไม่สำเร็จ" });
        return;
      }
      addFile({
        id,
        uploader_id: me(res),
        name: cleanName(req.query.name),
        mime: cleanMime(req.query.type),
        size: bytes,
      });
      res.json({ ok: true, id, size: bytes });
    },
  );

  r.get("/api/team/files/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const f = /^[a-f0-9]{32}$/.test(id) ? getFile(id) : undefined;
    // ยังไม่ได้ส่ง = ดูได้แค่คนอัป (พรีวิวก่อนส่ง) · ส่งแล้ว = ดูได้ถ้าเข้าห้องนั้นได้
    const allowed =
      f && (f.room ? canAccessRoom(f.room, me(res)) : f.uploader_id === me(res));
    if (!f || !allowed) {
      res.status(404).json({ ok: false, error: "ไม่พบไฟล์" });
      return;
    }
    const inline = INLINE.has(f.mime) && req.query.download === undefined;
    res.set({
      "Content-Type": inline ? f.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "X-Content-Type-Options": "nosniff",
      // ต่อให้เบราว์เซอร์เปิดเป็นหน้าเว็บ ก็รันสคริปต์/แตะ cookie ไม่ได้
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
      "Cache-Control": "private, max-age=86400",
    });
    res.sendFile(filePath(f.id), { headers: {} }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  return r;
}
