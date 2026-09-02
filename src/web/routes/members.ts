/** สมาชิก (บัตรประจำตัว), ค่าความเคลื่อนไหว/XP และตารางอันดับ */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { getMember, listMembers } from "../../idcard/members.js";
import { getCardImage } from "../../idcard/cardCache.js";
import { getVoiceState } from "../../store/voiceState.js";
import {
  getActivity,
  levelProgress,
  topByVoice,
  topByXp,
  type Activity,
} from "../../store/activityStore.js";
import { getWarnings } from "../../modules/warningStore.js";
import { resolveNames } from "../userNames.js";

type Filter = "" | "voice" | "mute" | "deaf" | "offline";
const FILTERS = new Set<Filter>(["", "voice", "mute", "deaf", "offline"]);

export function memberRoutes(client?: Client): Router {
  const r = Router();

  /**
   * รายชื่อสมาชิก — กรอง/ค้นหา/แบ่งหน้าฝั่ง server
   *
   * ชื่อผู้ใช้ไม่ได้อยู่ใน DB (อยู่ที่ Discord) เลยต้องดึงชื่อของ "ทุกคนที่ผ่านตัวกรองอื่น"
   * ก่อนถึงจะค้นด้วยชื่อได้ — ยอมได้เพราะรายชื่อบัตรเป็นหลักสิบ ไม่ใช่สมาชิกทั้งเซิร์ฟเวอร์
   * และ discord.js cache ชื่อไว้ให้แล้วหลังดึงรอบแรก
   */
  r.get("/api/members", async (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 100);
    const raw = String(req.query.filter ?? "") as Filter;
    const filter: Filter = FILTERS.has(raw) ? raw : "";
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const withVoice = listMembers().map((m) => ({
      ...m,
      voice: getVoiceState(m.id),
    }));

    const filtered = withVoice.filter((m) => {
      if (filter === "voice") return Boolean(m.voice);
      if (filter === "offline") return !m.voice;
      if (filter === "mute") return Boolean(m.voice?.selfMute || m.voice?.serverMute);
      if (filter === "deaf") return Boolean(m.voice?.selfDeaf || m.voice?.serverDeaf);
      return true;
    });

    const names = await resolveNames(
      client,
      filtered.map((m) => m.id),
    );

    const matched = q
      ? filtered.filter((m) => {
          const name = (names[m.id] ?? "").toLowerCase();
          return (
            name.includes(q) ||
            m.id.includes(q) ||
            String(m.member_number).includes(q) ||
            m.bias.toLowerCase().includes(q)
          );
        })
      : filtered;

    // เรียงตามเลขสมาชิก — คงที่ ไม่สลับตำแหน่งระหว่างเลื่อนหน้าเหมือนเรียงตามสถานะเสียง
    matched.sort((a, b) => a.member_number - b.member_number);

    res.json({
      total: matched.length,
      offset,
      limit,
      entries: matched.slice(offset, offset + limit).map((m) => {
        const act = getActivity(m.id);
        return {
          ...m,
          username: names[m.id] ?? m.id,
          level: act.level,
          xp: act.xp,
          warnings: getWarnings(m.id).length,
        };
      }),
    });
  });

  /** รูปบัตรของสมาชิกคนนั้น (สร้างสด ๆ จาก avatar + ข้อมูล) */
  r.get("/api/members/:id/card.png", async (req: Request, res: Response) => {
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

  /** ประวัติการเตือนของคนคนนั้น — ใช้ตอนกดดูรายละเอียดก่อนตัดสินใจลงโทษ */
  r.get("/api/members/:id/warnings", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!id) {
      res.status(400).json({ error: "missing id" });
      return;
    }
    res.json(getWarnings(id));
  });

  // ---------- Activity / XP ----------
  /** เติมชื่อ + ความคืบหน้าของเลเวลให้ activity */
  async function decorate(rows: Activity[]) {
    const names = await resolveNames(
      client,
      rows.map((a) => a.userId),
    );
    return rows.map((a) => ({
      ...a,
      username: names[a.userId] ?? a.userId,
      ...levelProgress(a.xp),
    }));
  }

  r.get("/api/activity/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!id) {
      res.status(400).json({ error: "missing id" });
      return;
    }
    const [row] = await decorate([getActivity(id)]);
    res.json(row);
  });

  /** อันดับ — ?by=xp|voice&limit=n */
  r.get("/api/leaderboard", async (req: Request, res: Response) => {
    const by = req.query.by === "voice" ? "voice" : "xp";
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const rows = by === "voice" ? topByVoice(limit) : topByXp(limit);
    res.json({ by, entries: await decorate(rows) });
  });

  return r;
}
