import { config } from "../config.js";
import { db } from "./db.js";

/**
 * ปรับ config สดจากหน้า Settings — เก็บทับในตาราง settings ของ data/bot.db
 * โหลด override ตอนบูต (applyOverrides) แล้ว mutate object config ตรง ๆ
 * (ทุกโมดูลอ่าน config ตอนใช้งาน เลยมีผลทันทีไม่ต้อง restart)
 */

type Item = {
  key: string;
  label: string;
  // id = Discord ID เดี่ยว (ตัวเลขหรือว่าง), list = ข้อความหลายค่า, idlist = Discord ID หลายค่า
  type: "bool" | "int" | "select" | "id" | "list" | "idlist";
  options?: string[];
};

export const SECTIONS: { section: string; items: Item[] }[] = [
  {
    section: "Anti-raid",
    items: [
      { key: "antiRaid.enabled", label: "เปิดใช้งาน", type: "bool" },
      { key: "antiRaid.joinThreshold", label: "คนเข้าเกิน (คน)", type: "int" },
      { key: "antiRaid.joinWindowMs", label: "ภายใน (มิลลิวินาที)", type: "int" },
      { key: "antiRaid.minAccountAgeMs", label: "อายุ account ที่น่าสงสัย (ms)", type: "int" },
      { key: "antiRaid.action", label: "การลงโทษ", type: "select", options: ["kick", "ban", "lockdown"] },
    ],
  },
  {
    section: "Anti-spam",
    items: [
      { key: "antiSpam.enabled", label: "เปิดใช้งาน", type: "bool" },
      { key: "antiSpam.maxMessages", label: "ข้อความสูงสุด/หน้าต่าง", type: "int" },
      { key: "antiSpam.windowMs", label: "หน้าต่างเวลา (ms)", type: "int" },
      { key: "antiSpam.maxMentions", label: "mention สูงสุด/ข้อความ", type: "int" },
      { key: "antiSpam.maxDuplicates", label: "ข้อความซ้ำสูงสุด", type: "int" },
      { key: "antiSpam.timeoutMs", label: "timeout (ms)", type: "int" },
    ],
  },
  {
    section: "Auto-mod",
    items: [
      { key: "autoMod.enabled", label: "เปิดใช้งาน", type: "bool" },
      { key: "autoMod.blockInvites", label: "บล็อก invite เซิร์ฟเวอร์อื่น", type: "bool" },
      { key: "autoMod.blockPhishing", label: "บล็อกลิงก์ phishing", type: "bool" },
      { key: "autoMod.deleteOnViolation", label: "ลบข้อความที่ผิดทันที", type: "bool" },
      { key: "autoMod.bannedWords", label: "คำต้องห้าม", type: "list" },
    ],
  },
  {
    section: "AI Mod (toxic classifier)",
    items: [
      { key: "aiMod.enabled", label: "เปิดใช้งาน", type: "bool" },
      { key: "aiMod.timeoutMs", label: "timeout เรียก service (ms)", type: "int" },
      { key: "aiMod.deleteOnAuto", label: "ลบข้อความโซน auto ทันที", type: "bool" },
      { key: "aiMod.minLength", label: "ความยาวขั้นต่ำที่ส่งตรวจ (ตัวอักษร)", type: "int" },
    ],
  },
  {
    section: "Logging",
    items: [
      { key: "logging.memberJoinLeave", label: "เข้า-ออกเซิร์ฟเวอร์", type: "bool" },
      { key: "logging.voice", label: "ห้องเสียง", type: "bool" },
      { key: "logging.auditLog", label: "permission/audit", type: "bool" },
      { key: "logging.retentionDays", label: "เก็บ log กี่วัน (0 = ตลอด)", type: "int" },
      { key: "logChannelId", label: "ห้อง log (channel ID)", type: "id" },
    ],
  },
  {
    section: "ยกเว้น / Role",
    items: [
      { key: "exemptRoleIds", label: "role ที่ยกเว้น (role ID)", type: "idlist" },
      { key: "exemptUserIds", label: "user ที่ยกเว้น (user ID)", type: "idlist" },
      { key: "cardRoleId", label: "role คนมีบัตร (role ID)", type: "id" },
    ],
  },
  {
    section: "Warnings",
    items: [{ key: "warnings.enabled", label: "เปิดระบบเตือน", type: "bool" }],
  },
  {
    section: "Activity / XP",
    items: [
      { key: "activity.enabled", label: "เปิดระบบ XP", type: "bool" },
      { key: "activity.messageXp", label: "XP ต่อข้อความ", type: "int" },
      { key: "activity.messageCooldownMs", label: "cooldown ข้อความ (ms)", type: "int" },
      { key: "activity.voiceXpPerMin", label: "XP ต่อนาที (ห้องเสียง)", type: "int" },
      { key: "activity.voiceCountWhileMuted", label: "นับเวลาแม้ปิดไมค์", type: "bool" },
    ],
  },
];

const ALL = SECTIONS.flatMap((s) => s.items);
const ITEM_BY_KEY = new Map(ALL.map((i) => [i.key, i]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const root = config as any;

function getPath(p: string): unknown {
  return p.split(".").reduce((o, k) => (o == null ? o : o[k]), root);
}
function setPath(p: string, v: unknown): void {
  const ks = p.split(".");
  const last = ks.pop() as string;
  const o = ks.reduce((o, k) => o[k], root);
  o[last] = v;
}

/** รับได้ทั้ง array (จาก DB) และ string คั่นด้วย , หรือขึ้นบรรทัดใหม่ (จากฟอร์ม) */
function toList(v: unknown): string[] {
  return (Array.isArray(v) ? v.map(String) : String(v).split(/[,\n]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function coerce(item: Item, v: unknown): unknown {
  if (item.type === "bool") return Boolean(v);
  if (item.type === "int") {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (item.type === "select") {
    return item.options?.includes(String(v)) ? String(v) : getPath(item.key);
  }
  if (item.type === "id") {
    // Discord ID = ตัวเลขล้วน (ว่าง = ปิดฟีเจอร์) — ค่าเพี้ยนให้คงค่าเดิม
    const s = String(v).trim();
    return /^\d*$/.test(s) ? s : getPath(item.key);
  }
  if (item.type === "list") return toList(v);
  if (item.type === "idlist") return toList(v).filter((s) => /^\d+$/.test(s));
  return v;
}

export function getSettings() {
  return SECTIONS.map((s) => ({
    section: s.section,
    items: s.items.map((i) => ({ ...i, value: getPath(i.key) })),
  }));
}

const upsertSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
);

function persist(): void {
  const tx = db.transaction(() => {
    for (const i of ALL) {
      upsertSetting.run(i.key, JSON.stringify(getPath(i.key)));
    }
  });
  tx();
}

export function updateSettings(patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    const item = ITEM_BY_KEY.get(k);
    if (item) setPath(k, coerce(item, v));
  }
  persist();
}

/** โหลด override จาก DB ตอนบูต */
export function applyOverrides(): void {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  if (!rows.length) return;
  for (const { key, value } of rows) {
    const item = ITEM_BY_KEY.get(key);
    if (!item) continue;
    try {
      setPath(key, coerce(item, JSON.parse(value)));
    } catch {
      /* ค่าเสีย — ข้าม */
    }
  }
  console.log("⚙️  โหลด settings override จาก DB แล้ว");
}
