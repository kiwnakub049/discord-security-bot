import {
  AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildMember,
  type PartialGuildMember,
  type VoiceState,
} from "discord.js";
import { config } from "../config.js";
import { logEvent } from "../utils/logger.js";
import type { LogLevel } from "../store/logStore.js";

/* ---------------- เข้า / ออก เซิร์ฟเวอร์ ---------------- */

export async function logMemberJoin(member: GuildMember): Promise<void> {
  if (!config.logging.memberJoinLeave) return;
  const ageDays = Math.floor(
    (Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000),
  );
  await logEvent(member.client, "info", "member", "member_join", "สมาชิกเข้าเซิร์ฟเวอร์", [
    { name: "User", value: `${member.user.tag} (${member.id})` },
    { name: "อายุ account", value: `${ageDays} วัน` },
    { name: "สมาชิกทั้งหมด", value: `${member.guild.memberCount}` },
  ]);
}

export async function logMemberLeave(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (!config.logging.memberJoinLeave) return;
  const tag = member.user?.tag ?? "ไม่ทราบ";
  await logEvent(member.client, "info", "member", "member_leave", "สมาชิกออกจากเซิร์ฟเวอร์", [
    { name: "User", value: `${tag} (${member.id})` },
    { name: "สมาชิกทั้งหมด", value: `${member.guild.memberCount}` },
  ]);
}

/* ---------------- ห้องเสียง ---------------- */

// สถานะ on/off ในห้องเสียงที่อยากแยก log แต่ละแบบให้ชัด
const VOICE_TOGGLES: {
  key: "selfMute" | "selfDeaf" | "serverMute" | "serverDeaf" | "streaming" | "selfVideo";
  event: string;
  on: string;
  off: string;
  level: LogLevel;
}[] = [
  { key: "selfMute", event: "voice_mute", on: "ปิดไมค์ตัวเอง (ไมค์แดง)", off: "เปิดไมค์ตัวเอง", level: "info" },
  { key: "selfDeaf", event: "voice_deafen", on: "ปิดหูฟังตัวเอง (หูแดง)", off: "เปิดหูฟังตัวเอง", level: "info" },
  { key: "serverMute", event: "voice_server", on: "ถูกแอดมินปิดไมค์ (server mute)", off: "แอดมินเปิดไมค์ให้", level: "warn" },
  { key: "serverDeaf", event: "voice_server", on: "ถูกแอดมินปิดหูฟัง (server deafen)", off: "แอดมินเปิดหูฟังให้", level: "warn" },
  { key: "streaming", event: "voice_stream", on: "เริ่ม Go Live (แชร์หน้าจอ)", off: "หยุด Go Live", level: "info" },
  { key: "selfVideo", event: "voice_camera", on: "เปิดกล้อง", off: "ปิดกล้อง", level: "info" },
];

export async function logVoice(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  if (!config.logging.voice) return;
  const member = newState.member ?? oldState.member;
  if (!member) return;
  const user = `${member.user.tag} (${member.id})`;
  const chName = (s: VoiceState) => s.channel?.name ?? s.channelId ?? "-";

  // 1) เปลี่ยนห้อง: เข้า / ออก / ย้าย (แยกกันชัดเจน)
  if (oldState.channelId !== newState.channelId) {
    if (!oldState.channelId) {
      await logEvent(member.client, "info", "voice", "voice_join", "เข้าห้องเสียง", [
        { name: "User", value: user },
        { name: "ห้อง", value: chName(newState) },
      ]);
    } else if (!newState.channelId) {
      await logEvent(member.client, "info", "voice", "voice_leave", "ออกจากห้องเสียง", [
        { name: "User", value: user },
        { name: "ห้อง", value: chName(oldState) },
      ]);
    } else {
      await logEvent(member.client, "info", "voice", "voice_move", "ย้ายห้องเสียง", [
        { name: "User", value: user },
        { name: "จาก → ไป", value: `${chName(oldState)} → ${chName(newState)}` },
      ]);
    }
    return; // เปลี่ยนห้องแล้วจบรอบนี้
  }

  // 2) อยู่ห้องเดิม แต่สลับสถานะ: ไมค์ / หูฟัง / Go Live / กล้อง — แต่ละอย่างเป็น log แยก
  for (const t of VOICE_TOGGLES) {
    const before = Boolean(oldState[t.key]);
    const after = Boolean(newState[t.key]);
    if (before === after) continue;
    await logEvent(member.client, t.level, "voice", t.event, after ? t.on : t.off, [
      { name: "User", value: user },
      { name: "ห้อง", value: chName(newState) },
    ]);
  }
}

/* ---------------- การใช้ permission (audit log) ---------------- */

// เฉพาะ action ที่เกี่ยวกับสิทธิ์/การจัดการ ที่อยากเก็บ (อื่น ๆ ข้าม เพื่อลด noise)
const AUDIT_MAP: Partial<
  Record<AuditLogEvent, { title: string; level: LogLevel; event: string }>
> = {
  [AuditLogEvent.MemberKick]: { title: "เตะสมาชิก (kick)", level: "warn", event: "audit_kick" },
  [AuditLogEvent.MemberBanAdd]: { title: "แบนสมาชิก (ban)", level: "alert", event: "audit_ban" },
  [AuditLogEvent.MemberBanRemove]: { title: "ปลดแบน (unban)", level: "info", event: "audit_unban" },
  [AuditLogEvent.MemberRoleUpdate]: { title: "เปลี่ยน role สมาชิก", level: "warn", event: "audit_role" },
  [AuditLogEvent.MemberUpdate]: { title: "แก้ไขสมาชิก", level: "info", event: "audit_member" }, // แยกเป็น timeout/ชื่อเล่น ด้านล่าง
  [AuditLogEvent.RoleCreate]: { title: "สร้าง role ใหม่", level: "warn", event: "audit_role" },
  [AuditLogEvent.RoleUpdate]: { title: "แก้ไข role / permission", level: "warn", event: "audit_role" },
  [AuditLogEvent.RoleDelete]: { title: "ลบ role", level: "warn", event: "audit_role" },
  [AuditLogEvent.ChannelCreate]: { title: "สร้างห้อง", level: "info", event: "audit_channel" },
  [AuditLogEvent.ChannelDelete]: { title: "ลบห้อง", level: "warn", event: "audit_channel" },
  [AuditLogEvent.ChannelOverwriteCreate]: { title: "ตั้งสิทธิ์ในห้อง", level: "warn", event: "audit_channel" },
  [AuditLogEvent.ChannelOverwriteUpdate]: { title: "แก้สิทธิ์ในห้อง", level: "warn", event: "audit_channel" },
  [AuditLogEvent.ChannelOverwriteDelete]: { title: "ลบสิทธิ์ในห้อง", level: "warn", event: "audit_channel" },
};

function describeTarget(entry: GuildAuditLogsEntry): string {
  const t = entry.target as { tag?: string; name?: string; id?: string } | null;
  if (t?.tag) return `${t.tag} (${t.id})`;
  if (t?.name) return `${t.name} (${t.id})`;
  return entry.targetId ?? "-";
}

function summarizeChanges(entry: GuildAuditLogsEntry): string {
  const parts: string[] = [];
  for (const c of entry.changes ?? []) {
    if (c.key === "$add" || c.key === "$remove") {
      const roles = Array.isArray(c.new)
        ? (c.new as { name?: string }[]).map((r) => r.name).join(", ")
        : "";
      parts.push(`${c.key === "$add" ? "+" : "−"}role: ${roles}`);
    } else {
      parts.push(String(c.key));
    }
  }
  return parts.join(" | ") || "-";
}

export async function logAuditEntry(
  entry: GuildAuditLogsEntry,
  guild: Guild,
): Promise<void> {
  if (!config.logging.auditLog) return;
  const mapped = AUDIT_MAP[entry.action as AuditLogEvent];
  if (!mapped) return; // action ที่ไม่ได้สนใจ — ข้าม

  const executor = entry.executor
    ? `${entry.executor.tag} (${entry.executorId})`
    : (entry.executorId ?? "ไม่ทราบ");

  const fields = [
    { name: "ผู้ทำ", value: executor },
    { name: "เป้าหมาย", value: describeTarget(entry) },
    { name: "รายละเอียด", value: summarizeChanges(entry) },
  ];
  if (entry.reason) fields.push({ name: "เหตุผล", value: entry.reason });

  let { title, level, event } = mapped;

  // แยก MemberUpdate ให้ชัด: timeout (หมดเวลา) vs แก้ไขอื่น ๆ (ชื่อเล่น ฯลฯ)
  if (entry.action === AuditLogEvent.MemberUpdate) {
    const timeout = entry.changes?.find(
      (c) => c.key === "communication_disabled_until",
    );
    if (timeout) {
      const applied = timeout.new != null;
      title = applied ? "ตั้ง timeout (หมดเวลาพูดชั่วคราว)" : "ปลด timeout";
      level = applied ? "warn" : "info";
      event = "audit_timeout";
    } else {
      title = "แก้ไขสมาชิก (ชื่อเล่น ฯลฯ)";
    }
  }

  await logEvent(guild.client, level, "audit", event, title, fields);
}
