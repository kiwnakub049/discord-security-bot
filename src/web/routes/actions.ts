/** ปฏิบัติการที่ mod สั่งจากหน้าเว็บ — ban / kick / timeout / warn / ล็อกเซิร์ฟเวอร์ */
import { Router, type Request, type Response } from "express";
import type { Client, Guild } from "discord.js";
import { clearWarnings } from "../../modules/warningStore.js";
import { setGuildLock } from "../../modules/lockdown.js";
import { warnMember } from "../../modules/warnAction.js";
import { dmAction } from "../../modules/dmNotice.js";
import { releaseMuteNow, type ReleaseResult } from "../../modules/muteEnforce.js";
import { listActiveMutes, listReleasePending } from "../../modules/mutePunishmentStore.js";
import { resolveNames } from "../userNames.js";
import type { LogCategory, LogLevel } from "../../store/logStore.js";
import { logEvent } from "../../utils/logger.js";

type ActionType = "ban" | "kick" | "timeout" | "untimeout" | "warn";

export function actionRoutes(client?: Client): Router {
  const r = Router();

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
    type: ActionType,
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
      const dmTag = (sent: boolean) =>
        member ? (sent ? "📨 DM แล้ว" : "(DM ไม่ได้)") : "";

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
        const result = await warnMember(member, "dashboard", actor, reason);
        msg = `เตือนแล้ว (ครั้งที่ ${result.count}) ${result.actionMsg} ${
          result.dmSent ? "📨 DM แล้ว" : "(DM ไม่ได้)"
        }`.trim();
        level = result.level;
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
      res.status(500).json({
        ok: false,
        message: "ทำไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)",
      });
    }
  }

  for (const type of ["ban", "kick", "timeout", "untimeout", "warn"] as const) {
    r.post(`/api/action/${type}`, (req, res) => runMemberAction(req, res, type));
  }

  r.post("/api/action/clearwarnings", async (req: Request, res: Response) => {
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

  /* ─── ไมค์แดงจากระบบเตือน: รายชื่อที่โดนอยู่ + ปุ่มปลดทันที ─── */

  r.get("/api/mutes", async (_req: Request, res: Response) => {
    const guild = getGuild();
    const active = listActiveMutes();
    // ค้างปลด = ครบเวลาแล้วแต่ยังแดงติดตัว (อยู่นอกห้อง) — โชว์ด้วย mod จะได้รู้ว่ายังไม่ได้ปลดจริง
    const pending = listReleasePending().filter((p) => !active.some((a) => a.userId === p.userId));
    const ids = [...active.map((a) => a.userId), ...pending.map((p) => p.userId)];
    const names = await resolveNames(client, ids);
    const inVoice = (id: string) => Boolean(guild?.voiceStates.cache.get(id)?.channelId);
    res.json({
      mutes: [
        ...active.map((a) => ({
          userId: a.userId,
          name: names[a.userId] ?? a.userId,
          until: a.until,
          reason: a.reason,
          inVoice: inVoice(a.userId),
          pending: false,
        })),
        ...pending.map((p) => ({
          userId: p.userId,
          name: names[p.userId] ?? p.userId,
          until: null,
          reason: p.reason,
          inVoice: inVoice(p.userId),
          pending: true,
        })),
      ],
    });
  });

  const RELEASE_TEXT: Record<ReleaseResult, { ok: boolean; message: string }> = {
    unmuted: { ok: true, message: "ปลดไมค์แดงแล้ว" },
    pending: { ok: true, message: "ยกเลิกโทษแล้ว — ตอนนี้อยู่นอกห้องเสียง บอทจะปลดไมค์ให้ทันทีที่เข้าห้อง" },
    "not-muted": { ok: true, message: "ไม่ได้โดนไมค์แดงอยู่" },
    "not-found": { ok: false, message: "ไม่พบสมาชิกในเซิร์ฟเวอร์" },
    failed: { ok: false, message: "ปลดไม่สำเร็จ (เช็คสิทธิ์ Mute Members ของบอท)" },
  };

  r.post("/api/action/unmute", async (req: Request, res: Response) => {
    const guild = getGuild();
    const userId = String(req.body?.userId ?? "");
    const actor = String(res.locals.username);
    if (!guild || !/^\d+$/.test(userId)) {
      res.status(400).json({ ok: false, message: "ข้อมูลไม่ครบ" });
      return;
    }
    const result = await releaseMuteNow(guild, userId);
    res.json(RELEASE_TEXT[result]);
    if (client && (result === "unmuted" || result === "pending")) {
      await logEvent(client, "info", "security", "security_mute_end", "ปลดไมค์แดงก่อนเวลา (จาก dashboard)", [
        { name: "เป้าหมาย", value: userId },
        { name: "โดย (dashboard)", value: actor },
        { name: "ผล", value: RELEASE_TEXT[result].message },
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
    return {
      ok: true,
      message: `${allow ? "ปลดล็อก" : "ล็อก"} ${ok} ห้อง${fail ? ` (พลาด ${fail})` : ""}`,
    };
  }

  r.post("/api/action/lock", async (_req, res) => {
    res.json(await lockGuild(false, String(res.locals.username)));
  });
  r.post("/api/action/unlock", async (_req, res) => {
    res.json(await lockGuild(true, String(res.locals.username)));
  });

  return r;
}
