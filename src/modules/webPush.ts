import webpush from "web-push";
import type { AccessResolver } from "../auth/access.js";
import { categoryDef } from "./queueCategories.js";
import { queueEvents, type QueueRow } from "../store/queueStore.js";
import {
  deleteSub,
  loadVapid,
  markOk,
  subsFor,
  type PushSub,
  type PushTopic,
} from "../store/pushStore.js";
import { dmMembers, GENERAL, type TeamMessage } from "../store/teamChatStore.js";
import { tr } from "../web/i18n.js";

/**
 * แจ้งเตือนมือถือ/เบราว์เซอร์แบบ Web Push — เด้งแม้ปิดเว็บอยู่ (service worker ฝั่งเครื่องรับแล้วโชว์)
 *
 * เรื่องที่ส่ง (แต่ละเครื่องเลือกรับเองใน push_subs.topics):
 *   queue   — การ์ดใหม่ในคิวรอดำเนินการ
 *   mention — แชททีม: ถูกแท็ก / @all / ข้อความส่วนตัว
 *   general — แชททีม: ทุกข้อความในห้องรวม
 *
 * ส่งเฉพาะคนที่ยังมีสิทธิ์เข้า dashboard ตอนส่ง (ถอดยศแล้วเครื่องเก่าจะเงียบไปเอง)
 * เนื้อหาเข้ารหัสปลายทางถึงปลายทาง (RFC 8291) push service ของ Google/Apple อ่านไม่ได้
 */

export interface PushPayload {
  title: string;
  body: string;
  /** แจ้งเตือน tag เดียวกันทับกัน (เช่นแชทห้องเดียวกันไม่กองเป็นสิบอัน) */
  tag: string;
  /** กดแจ้งเตือนแล้วเปิดหน้านี้ */
  url: string;
}

type Sender = (sub: PushSub, payload: string, ttl: number) => Promise<void>;

let sender: Sender | null = null;
let access: AccessResolver | null = null;
let publicKey = "";
let listening = false;

/** error จาก push service: 404/410 = เครื่องนี้ยกเลิกไปแล้ว (ถอนแอป/ล้างเว็บ) ลบทิ้ง */
const gone = (err: unknown) => {
  const code = (err as { statusCode?: number })?.statusCode;
  return code === 404 || code === 410;
};

export function initPush(opts: { access: AccessResolver; sender?: Sender }): void {
  access = opts.access;
  const vapid = loadVapid(() => webpush.generateVAPIDKeys());
  publicKey = vapid.publicKey;
  if (opts.sender) {
    sender = opts.sender;
  } else {
    // Apple ต้องการ subject ที่เป็น https:// หรือ mailto: ที่ใช้งานได้
    let subject = "mailto:admin@example.com";
    try {
      const u = new URL(process.env.DASHBOARD_URL ?? "");
      if (u.protocol === "https:") subject = u.origin;
    } catch {
      /* ไม่ได้ตั้ง/ไม่ใช่ https (เช่นตอน dev) — ใช้ mailto */
    }
    webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
    sender = async (sub, payload, ttl) => {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
        TTL: ttl,
        urgency: "high",
      });
    };
  }
  if (!listening) {
    listening = true;
    queueEvents.on("added", (row: QueueRow) => void pushQueueItem(row));
  }
}

export const vapidPublicKey = (): string => publicKey;

/** ส่งให้ทุกเครื่องของคนที่ยังมีสิทธิ์ — คืนจำนวนเครื่องที่ส่งถึง */
export async function deliver(
  subs: PushSub[],
  build: (sub: PushSub) => PushPayload,
  ttl: number,
): Promise<number> {
  if (!sender || !access) return 0;
  const allowed = new Map<string, boolean>();
  let sent = 0;
  for (const sub of subs) {
    if (!allowed.has(sub.userId)) {
      allowed.set(sub.userId, (await access(sub.userId).catch(() => null)) !== null);
    }
    if (!allowed.get(sub.userId)) continue;
    try {
      await sender(sub, JSON.stringify(build(sub)), ttl);
      markOk(sub.endpoint);
      sent++;
    } catch (err) {
      if (gone(err)) deleteSub(sub.endpoint);
      else console.error("ส่ง push ไม่สำเร็จ:", (err as Error)?.message ?? err);
    }
  }
  return sent;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** การ์ดใหม่ในคิว */
export async function pushQueueItem(row: QueueRow): Promise<number> {
  const def = categoryDef(row.category);
  return deliver(
    subsFor("queue"),
    (sub) => ({
      title: def ? tr(def.label, sub.lang) : row.category,
      body: cut([row.title, row.detail].filter(Boolean).join(" · "), 180),
      tag: `queue:${row.category}`,
      url: "/",
    }),
    24 * 3600,
  );
}

/**
 * ข้อความแชททีม — คนที่ถูกแท็ก/@all/คุยส่วนตัวได้เรื่อง "mention" · คนอื่นในห้องรวมได้ "general"
 * ห้องรวมเห็นทุกคนในทีม = ผู้รับคือทุกเครื่องที่สมัครไว้ (deliver กรองคนที่หมดสิทธิ์ออกเอง)
 */
export async function pushTeamMessage(msg: TeamMessage, all: boolean): Promise<number> {
  const dm = msg.room !== GENERAL ? dmMembers(msg.room) : null;
  const everyone = dm
    ? dm
    : [...new Set([...subsFor("mention"), ...subsFor("general")].map((s) => s.userId))];
  const members = everyone.filter((id) => id !== msg.authorId);
  const direct = new Set(dm || all ? members : msg.mentions.filter((id) => id !== msg.authorId));
  const rest = dm ? [] : members.filter((id) => !direct.has(id));

  const preview = (lang: "th" | "en") =>
    cut(
      msg.body ||
        (lang === "en" ? `📎 ${msg.files.length} attachment(s)` : `📎 ไฟล์แนบ ${msg.files.length} ไฟล์`),
      160,
    );
  const title = (sub: PushSub, topic: PushTopic) => {
    const en = sub.lang === "en";
    if (dm) return en ? `${msg.authorName} (direct)` : `${msg.authorName} (ส่วนตัว)`;
    if (topic === "mention") return en ? `${msg.authorName} mentioned you` : `${msg.authorName} แท็กคุณ`;
    return en ? `${msg.authorName} · General` : `${msg.authorName} · ห้องรวม`;
  };
  const build = (topic: PushTopic) => (sub: PushSub) => ({
    title: title(sub, topic),
    body: preview(sub.lang),
    tag: `team:${msg.room}`,
    url: "/team",
  });

  let sent = 0;
  const viaMention = subsFor("mention", [...direct]);
  if (viaMention.length) sent += await deliver(viaMention, build("mention"), 3600);
  // ห้องรวม: คนที่ไม่ได้ถูกแท็ก + คนที่ถูกแท็กแต่ปิดเรื่องแท็กไว้ (รับห้องรวมอยู่ก็ยังควรเห็น)
  if (!dm) {
    const done = new Set(viaMention.map((s) => s.endpoint));
    const viaGeneral = subsFor("general", [...rest, ...direct]).filter((s) => !done.has(s.endpoint));
    if (viaGeneral.length) sent += await deliver(viaGeneral, build("general"), 3600);
  }
  return sent;
}

/** ปุ่ม "ลองส่ง" — ส่งถึงเครื่องนี้เครื่องเดียว */
export async function pushTest(sub: PushSub): Promise<boolean> {
  const en = sub.lang === "en";
  return (
    (await deliver(
      [sub],
      () => ({
        title: "Undawn Dashboard",
        body: en ? "Notifications are working on this device ✅" : "เครื่องนี้รับแจ้งเตือนได้แล้ว ✅",
        tag: "test",
        url: "/",
      }),
      600,
    )) > 0
  );
}
