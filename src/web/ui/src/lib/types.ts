/** รูปร่างข้อมูลที่ API ฝั่งบอทส่งมา — ต้องตรงกับ src/web/routes/*.ts */

export type LogLevel = "info" | "warn" | "alert";
export type LogCategory =
  | "security"
  | "member"
  | "voice"
  | "audit"
  | "partner"
  | "system";

export interface PartnerBot {
  id: string;
  name: string;
  role: string;
}

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  event: string;
  title: string;
  description?: string;
  fields: { name: string; value: string }[];
}

export interface LogPage {
  entries: LogEntry[];
  hasMore: boolean;
  nextCursor: number | null;
}

export interface HistoryPoint {
  t: number;
  info: number;
  warn: number;
  alert: number;
  total: number;
}

export interface History {
  bucket: "hour" | "day";
  from: number;
  size: number;
  points: HistoryPoint[];
}

export interface VerdictStats {
  total: number;
  toxic: number;
  ok: number;
}

export interface Stats {
  logs: {
    total: number;
    today: number;
    byLevel: Record<LogLevel, number>;
    byCategory: Record<string, number>;
    todayByLevel: Record<LogLevel, number>;
  };
  members: number;
  warnings: number;
  ai: VerdictStats;
  voice: {
    count: number;
    users: {
      userId: string;
      username: string;
      channel: string;
      muted: boolean;
      deaf: boolean;
    }[];
  };
  alerts: LogEntry[];
}

export interface SystemInfo {
  cpu: {
    tempC: number | null;
    freqMhz: number | null;
    maxFreqMhz: number | null;
    cores: number;
    load: number[];
  };
  memory: { totalMb: number; availableMb: number; usedPct: number };
  disk: { totalGb: number; freeGb: number; usedPct: number } | null;
  fanRpm: number | null;
  power: {
    raw?: string;
    underVoltageNow?: boolean;
    throttledNow?: boolean;
    tempLimitNow?: boolean;
    underVoltagePast?: boolean;
    throttledPast?: boolean;
    tempLimitPast?: boolean;
    lowVoltageAlarm: boolean | null;
  };
  /** ฟีเจอร์ที่ปิดอยู่เพราะรันโหมดไม่ขอ privileged intent — null = ปกติ */
  degraded: string[] | null;
  uptime: { hostSec: number; botSec: number };
  process: { rssMb: number; node: string };
}

export interface VoiceInfo {
  channelId: string;
  channelName: string;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  since: number;
}

export interface Member {
  id: string;
  username: string;
  member_number: number;
  join_date: string;
  bias: string;
  status: string;
  level: number;
  xp: number;
  warnings: number;
  voice: VoiceInfo | null;
}

export interface MemberPage {
  total: number;
  offset: number;
  limit: number;
  entries: Member[];
}

export interface RankEntry {
  userId: string;
  username: string;
  messages: number;
  voiceSeconds: number;
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  pct: number;
}

export interface Warning {
  id: number;
  reason: string;
  moderatorId: string;
  moderatorTag: string;
  timestamp: number;
}

export interface OledConfig {
  page: string;
  pages: { id: string; label: string }[];
}

export interface SettingItem {
  key: string;
  label: string;
  /** id = Discord ID เดี่ยว, list = ข้อความหลายค่า, idlist = ID หลายค่า */
  type: "bool" | "int" | "float" | "select" | "id" | "list" | "idlist";
  options?: string[];
  value: unknown;
}

export interface SettingSection {
  section: string;
  items: SettingItem[];
}

export interface DeviceSession {
  id: string;
  /** เครื่องที่กำลังใช้ดูหน้านี้อยู่ */
  current: boolean;
  createdAt: number;
  lastSeen: number;
  expires: number;
  ip: string;
  device: string;
  browser: string;
}

export type Verdict = "toxic" | "ok";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/* ───── คิวรอดำเนินการ (ต้องตรงกับ src/web/routes/queue.ts) ───── */

export type QueueSeverity = "alert" | "warn" | "info";

export interface QueueOutcome {
  key: string;
  label: string;
  tone: "danger" | "accent" | "plain";
}

export interface QueueItem {
  id: number;
  title: string;
  detail: string | null;
  subjectId: string | null;
  subjectName: string | null;
  createdAt: number;
}

export interface QueueCategoryMeta {
  key: string;
  label: string;
  severity: QueueSeverity;
  overdueAfterMin: number;
  verb: string;
  unit: string;
  outcomes: QueueOutcome[];
}

export interface QueueStack extends QueueCategoryMeta {
  count: number;
  oldestAt: number;
  items: QueueItem[];
}

export interface QueueSummary {
  stacks: QueueStack[];
  idle: { key: string; label: string }[];
  now: number;
}
