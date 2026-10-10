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
import { partnerById, partnerLabel } from "../partners.js";
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

/**
 * สถานะ on/off ในห้องเสียงที่อยากแยก log แต่ละแบบให้ชัด
 *
 * event ถูกเติม _on / _off ต่อท้ายตอนบันทึก — จำเป็นเพราะหน้าเว็บมีกิ่ง "ไมค์แดง"
 * กับ "หูแดง" ที่ต้องการเฉพาะ "ขาปิด" ถ้าใช้ event เดียวกันทั้งสองขา
 * กดกิ่งนั้นแล้วจะได้คนที่เปิดไมค์กลับมาปนมาด้วย ซึ่งไม่ใช่สิ่งที่ผู้ใช้ถาม
 */
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

/**
 * บรรยายคนหนึ่งคนแบบสืบย้อนได้ — ชื่อที่เห็นในเซิร์ฟเวอร์, username จริง, และ id
 *
 * ต้องมีครบสามอย่าง เพราะสองอย่างแรกเปลี่ยนได้ตลอดเวลา คนที่ก่อเรื่องแล้วเปลี่ยนชื่อ
 * จะตามไม่เจอถ้าเก็บแต่ชื่อ ส่วน id เปลี่ยนไม่ได้ แต่เอาไปเล่าให้คนอื่นฟังไม่รู้เรื่อง
 */
function describeMember(m: GuildMember): string {
  const nick = m.nickname && m.nickname !== m.user.username ? `${m.nickname} ` : "";
  return `${nick}(${m.user.username}) ${m.id}`;
}

/** ชื่อห้องพร้อมหมวดและ id — ชื่อห้องซ้ำกันได้ id ไม่ซ้ำ */
function describeChannel(s: VoiceState): string {
  const ch = s.channel;
  if (!ch) return s.channelId ?? "-";
  const category = ch.parent?.name;
  return `${category ? `${category} › ` : ""}${ch.name} (${ch.id})`;
}

/**
 * รายชื่อคนที่อยู่ในห้อง ณ วินาทีนั้น พร้อมสถานะไมค์/หูฟัง/แชร์จอ/กล้อง
 *
 * นี่คือข้อมูลที่หายไปตลอดกาลถ้าไม่บันทึกตอนเกิดเหตุ — พอมีเรื่องแล้วค่อยไปถามว่า
 * "ตอนนั้นใครอยู่ในห้องบ้าง" จะไม่มีใครตอบได้ ต้องอาศัยความจำคนล้วน ๆ
 */
function describeRoom(state: VoiceState): string {
  const ch = state.channel;
  if (!ch) return "-";
  const lines = [...ch.members.values()].map((m) => {
    const v = m.voice;
    const tags = [
      v.selfMute || v.serverMute ? "ปิดไมค์" : "เปิดไมค์",
      v.selfDeaf || v.serverDeaf ? "ปิดหู" : "เปิดหู",
      ...(v.streaming ? ["แชร์จอ"] : []),
      ...(v.selfVideo ? ["เปิดกล้อง"] : []),
    ];
    return `${describeMember(m)} (${tags.join(") (")})`;
  });
  return lines.length ? lines.join("\n") : "(ไม่มีใครเหลืออยู่)";
}

export async function logVoice(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  if (!config.logging.voice) return;
  const member = newState.member ?? oldState.member;
  if (!member) return;
  const user = describeMember(member);

  // 1) เปลี่ยนห้อง: เข้า / ออก / ย้าย (แยกกันชัดเจน)
  if (oldState.channelId !== newState.channelId) {
    if (!oldState.channelId) {
      const room = describeRoom(newState);
      await logEvent(member.client, "info", "voice", "voice_join", "เข้าห้องเสียง", [
        { name: "User", value: user },
        { name: "ห้อง", value: describeChannel(newState) },
        { name: `คนในห้องตอนนั้น (${newState.channel?.members.size ?? 0})`, value: room },
      ]);
    } else if (!newState.channelId) {
      // ห้องเดิม — คนที่ยังเหลืออยู่หลังคนนี้ออกไป
      const room = describeRoom(oldState);
      await logEvent(member.client, "info", "voice", "voice_leave", "ออกจากห้องเสียง", [
        { name: "User", value: user },
        { name: "ห้อง", value: describeChannel(oldState) },
        { name: `คนที่เหลือในห้อง (${oldState.channel?.members.size ?? 0})`, value: room },
      ]);
    } else {
      await logEvent(member.client, "info", "voice", "voice_move", "ย้ายห้องเสียง", [
        { name: "User", value: user },
        { name: "จาก", value: describeChannel(oldState) },
        { name: "ไป", value: describeChannel(newState) },
        {
          name: `คนในห้องปลายทาง (${newState.channel?.members.size ?? 0})`,
          value: describeRoom(newState),
        },
        {
          name: `คนที่เหลือในห้องเดิม (${oldState.channel?.members.size ?? 0})`,
          value: describeRoom(oldState),
        },
      ]);
    }
    return; // เปลี่ยนห้องแล้วจบรอบนี้
  }

  // 2) อยู่ห้องเดิม แต่สลับสถานะ: ไมค์ / หูฟัง / Go Live / กล้อง — แต่ละอย่างเป็น log แยก
  for (const t of VOICE_TOGGLES) {
    const before = Boolean(oldState[t.key]);
    const after = Boolean(newState[t.key]);
    if (before === after) continue;
    await logEvent(
      member.client,
      t.level,
      "voice",
      `${t.event}_${after ? "on" : "off"}`,
      after ? t.on : t.off,
      [
        { name: "User", value: user },
        { name: "ห้อง", value: describeChannel(newState) },
      ],
    );
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
  // แยก event ของห้องเป็นสร้าง / ลบ / แก้สิทธิ์ — "ลบห้อง" เป็นเรื่องที่ต้องรู้ทันที
  // ส่วนการแก้สิทธิ์เกิดบ่อยมาก ถ้าอยู่ event เดียวกันการลบห้องจะจมหายไป
  [AuditLogEvent.ChannelCreate]: { title: "สร้างห้อง", level: "info", event: "audit_channel_create" },
  [AuditLogEvent.ChannelDelete]: { title: "ลบห้อง", level: "warn", event: "audit_channel_delete" },
  [AuditLogEvent.ChannelOverwriteCreate]: { title: "ตั้งสิทธิ์ในห้อง", level: "warn", event: "audit_channel_perm" },
  [AuditLogEvent.ChannelOverwriteUpdate]: { title: "แก้สิทธิ์ในห้อง", level: "warn", event: "audit_channel_perm" },
  [AuditLogEvent.ChannelOverwriteDelete]: { title: "ลบสิทธิ์ในห้อง", level: "warn", event: "audit_channel_perm" },
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

  // บอทพาร์ทเนอร์มักถูกส่งมาแบบ resolve ชื่อไม่ได้ (executor เป็น null เหลือแต่ id)
  // เลยต้องเช็คจาก executorId ตรง ๆ ก่อน แล้วค่อยใช้ชื่อจากทะเบียนแทน
  const partner = partnerById(entry.executorId);
  const executor = partner
    ? partnerLabel(partner)
    : entry.executor
      ? `${entry.executor.tag} (${entry.executorId})`
      : (entry.executorId ?? "ไม่ทราบ");

  const fields = [
    { name: "ผู้ทำ", value: executor },
    { name: "เป้าหมาย", value: describeTarget(entry) },
    { name: "รายละเอียด", value: summarizeChanges(entry) },
  ];
  if (partner) fields.push({ name: "บอทพาร์ทเนอร์", value: partner.role });
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

  // แยกหมวดให้บอทพาร์ทเนอร์ ไม่ให้ท่วมหน้า "ตรวจสอบ" จนหางานที่คนทำไม่เจอ
  await logEvent(
    guild.client,
    level,
    partner ? "partner" : "audit",
    event,
    title,
    fields,
  );
}
