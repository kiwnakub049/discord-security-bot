/** ตัวเลขสรุปหน้าแรก */
import { Router, type Request, type Response } from "express";
import type { Client } from "discord.js";
import { getLogs, logTotals } from "../../store/logStore.js";
import { memberCount } from "../../idcard/members.js";
import { totalWarnings } from "../../modules/warningStore.js";
import { getVoiceStates } from "../../store/voiceState.js";
import { verdictStats } from "../../store/aiVerdictStore.js";
import { resolveNames } from "../userNames.js";

const DAY = 24 * 60 * 60 * 1000;

export function overviewRoutes(client?: Client): Router {
  const r = Router();

  r.get("/api/stats", async (_req: Request, res: Response) => {
    // นับด้วย SQL ทั้งตาราง ไม่ใช่ดึง 500 แถวล่าสุดมานับเหมือนของเดิม
    const all = logTotals();
    const today = logTotals(Date.now() - DAY);

    const voice = getVoiceStates();
    // จำกัด 25 คน — หน้าแรกไม่ได้ต้องการรายชื่อครบ แค่พอเห็นว่าใครอยู่
    const shown = voice.slice(0, 25);
    const names = await resolveNames(
      client,
      shown.map((v) => v.userId),
    );

    res.json({
      logs: {
        total: all.total,
        today: today.total,
        byLevel: all.byLevel,
        byCategory: all.byCategory,
        todayByLevel: today.byLevel,
      },
      members: memberCount(),
      warnings: totalWarnings(),
      ai: verdictStats(),
      voice: {
        count: voice.length,
        users: shown.map((v) => ({
          userId: v.userId,
          username: names[v.userId] ?? v.userId,
          channel: v.channelName,
          muted: v.selfMute || v.serverMute,
          deaf: v.selfDeaf || v.serverDeaf,
        })),
      },
      alerts: getLogs({ level: "alert", limit: 6 }),
    });
  });

  return r;
}
