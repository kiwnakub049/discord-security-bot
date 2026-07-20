import { type GuildMember } from "discord.js";
import { config } from "../config.js";
import { logEvent } from "../utils/logger.js";
import { setGuildLock } from "./lockdown.js";

// เก็บผู้เข้าล่าสุดของแต่ละเซิร์ฟเวอร์ (member + เวลา) ไว้จัดการทั้ง batch ตอน raid
const recentJoins = new Map<string, { member: GuildMember; at: number }[]>();
// กันการ trigger ซ้ำ ๆ ระหว่างที่กำลัง raid อยู่
const raidActive = new Set<string>();

function isNewAccount(member: GuildMember): boolean {
  return Date.now() - member.user.createdTimestamp < config.antiRaid.minAccountAgeMs;
}

/** kick/ban สมาชิกที่เป็น account ใหม่ (คืน true ถ้าลงมือจริง) */
async function actOnMember(member: GuildMember): Promise<boolean> {
  if (!isNewAccount(member)) return false; // ไม่แตะสมาชิกจริง (account เก่า)
  try {
    if (config.antiRaid.action === "ban") {
      await member.ban({ reason: "Anti-raid: account ใหม่เข้าช่วง raid" });
    } else {
      await member.kick("Anti-raid: account ใหม่เข้าช่วง raid");
    }
    return true;
  } catch (err) {
    console.error("ดำเนินการ raid response ไม่สำเร็จ:", err);
    return false;
  }
}

/**
 * เรียกทุกครั้งที่มีคนใหม่เข้าเซิร์ฟเวอร์
 * 1. เช็คอายุ account ถ้าใหม่เกินไป => log เตือน
 * 2. นับจำนวนคนเข้าในช่วงเวลา ถ้าเกิน threshold => raid response
 * 3. ระหว่างที่ raid ยัง active: จัดการ account ใหม่ที่ทยอยเข้ามาต่อเนื่องทันที
 */
export async function handleMemberJoin(member: GuildMember): Promise<void> {
  if (!config.antiRaid.enabled) return;

  const guildId = member.guild.id;
  const now = Date.now();
  const newAccount = isNewAccount(member);

  // --- เช็คอายุ account ---
  if (newAccount) {
    const days = Math.floor(
      (now - member.user.createdTimestamp) / (24 * 60 * 60 * 1000),
    );
    await logEvent(member.client, "warn", "security", "security_newaccount", "Account ใหม่เข้าเซิร์ฟเวอร์", [
      { name: "User", value: `${member.user.tag} (${member.id})` },
      { name: "อายุ account", value: `${days} วัน` },
    ]);
  }

  // --- เก็บผู้เข้าในหน้าต่างเวลา ---
  const recent = (recentJoins.get(guildId) ?? []).filter(
    (r) => now - r.at < config.antiRaid.joinWindowMs,
  );
  recent.push({ member, at: now });
  recentJoins.set(guildId, recent);

  // --- ระหว่าง raid ยัง active: จัดการ account ใหม่ที่ทยอยเข้ามาต่อทันที ---
  if (raidActive.has(guildId)) {
    if (newAccount && config.antiRaid.action !== "lockdown") {
      await actOnMember(member);
    }
    return;
  }

  if (recent.length >= config.antiRaid.joinThreshold) {
    raidActive.add(guildId);
    await triggerRaidResponse(member, recent);
    // ปลดสถานะ raid หลังจากผ่านหน้าต่างเวลาไป เพื่อให้ตรวจจับรอบใหม่ได้
    setTimeout(() => raidActive.delete(guildId), config.antiRaid.joinWindowMs * 3);
  }
}

async function triggerRaidResponse(
  member: GuildMember,
  recent: { member: GuildMember; at: number }[],
): Promise<void> {
  if (config.antiRaid.action === "lockdown") {
    await logEvent(
      member.client,
      "alert",
      "security",
      "security_raid",
      "ตรวจพบ RAID!",
      [
        { name: "จำนวนคนเข้า", value: `${recent.length} คนใน ${config.antiRaid.joinWindowMs / 1000}s` },
        { name: "การตอบสนอง", value: config.antiRaid.action },
      ],
      "บอทกำลังดำเนินการป้องกันอัตโนมัติ",
    );
    await lockdownGuild(member);
    return;
  }

  // kick/ban คนที่เพิ่งเข้าทั้ง batch ซึ่งเป็น account ใหม่ (ไม่ใช่แค่คนที่ทำให้ทะลุ threshold)
  let acted = 0;
  for (const r of recent) {
    if (await actOnMember(r.member)) acted++;
  }

  await logEvent(
    member.client,
    "alert",
    "security",
    "security_raid",
    "ตรวจพบ RAID!",
    [
      { name: "จำนวนคนเข้า", value: `${recent.length} คนใน ${config.antiRaid.joinWindowMs / 1000}s` },
      { name: "การตอบสนอง", value: config.antiRaid.action },
      { name: `จัดการแล้ว (${config.antiRaid.action})`, value: `${acted} account ใหม่` },
    ],
    "บอทกำลังดำเนินการป้องกันอัตโนมัติ",
  );
}

/**
 * ล็อกทุกห้อง (ผ่าน setGuildLock — ครอบคลุม text/forum/voice ทั้งหมด)
 */
async function lockdownGuild(member: GuildMember): Promise<void> {
  const { ok } = await setGuildLock(member.guild, true);

  await logEvent(member.client, "alert", "security", "security_lockdown", "Lockdown สำเร็จ", [
    { name: "ห้องที่ล็อก", value: `${ok}` },
  ], [
    "ปิดการส่งข้อความของทุกห้องแล้ว",
    "ใช้คำสั่ง /unlock เพื่อปลดล็อกเมื่อสถานการณ์ปกติ",
  ].join("\n"));
}
