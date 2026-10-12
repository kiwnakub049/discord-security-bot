import type { Message } from "discord.js";

/**
 * บริบทของบทสนทนาที่ส่งให้ Claude ดูพร้อมข้อความที่ตัดสิน
 *
 * ข้อความเดียวโดด ๆ บอกไม่ได้ว่า "ด่าใคร" หรือ "แซะใคร" — ต้องเห็นว่าก่อนหน้าคุยอะไรกัน
 * ตอบกลับใคร และแท็กใคร ถึงจะแยก "เพื่อนด่าเล่นกัน" ออกจาก "ด่าคนจริงจัง" ได้
 *
 * เก็บข้อความล่าสุดของแต่ละห้องไว้ในแรมจาก messageCreate เอง (ไม่ยิง Discord API ทุกข้อความ)
 * บอทรีสตาร์ท = บริบทว่างไปช่วงแรก ไม่เป็นไร
 */

/** ข้อความก่อนหน้าในห้องที่ส่งให้ Claude ดู */
export const CONTEXT_SIZE = 8;
/** เก่ากว่านี้ถือว่าคนละบทสนทนาแล้ว */
export const CONTEXT_WINDOW_MS = 10 * 60_000;
/** ความยาวต่อข้อความในบริบท — บริบทมีไว้ดูว่าคุยอะไรกัน ไม่ต้องครบทุกตัว */
const LINE_MAX = 300;
/** ห้องที่จำได้มากสุด — กันแรมโตไม่จบ (ห้องที่เงียบนานสุดถูกทิ้งก่อน) */
const MAX_CHANNELS = 200;

export interface ContextLine {
  id: string;
  author: string;
  text: string;
  at: number;
}

export interface ChatContext {
  channel: string;
  author: string;
  recent: ContextLine[];
  replyTo?: { author: string; text: string };
  mentions: string[];
}

const buffers = new Map<string, ContextLine[]>();

/** ชื่อที่โชว์ให้ Claude — ตัดตัวที่ทำให้แท็กในพรอมต์เพี้ยนออก */
function cleanName(name: string): string {
  return name.replace(/[<>"\n\r]/g, "").trim().slice(0, 40) || "ไม่ทราบชื่อ";
}

/** ข้อความในบริบทเป็น "ข้อมูล" — กันคนพิมพ์ </context> เพื่อหลุดออกจากกรอบ */
function cleanText(text: string, max = LINE_MAX): string {
  const t = text.replace(/<\/?(context|message|reply_to)\b/gi, (m) => m.replace("<", "‹"));
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function nameOf(message: Message): string {
  return cleanName(
    message.member?.displayName ?? message.author.globalName ?? message.author.username ?? message.author.tag ?? "",
  );
}

/** จำข้อความนี้ไว้เป็นบริบทของข้อความถัดไปในห้อง */
export function rememberMessage(message: Message, now = Date.now()): void {
  const text = message.content?.trim();
  if (!text) return;
  const key = message.channelId;
  const lines = (buffers.get(key) ?? []).filter((l) => now - l.at <= CONTEXT_WINDOW_MS);
  lines.push({ id: message.id, author: nameOf(message), text: cleanText(text), at: now });
  buffers.delete(key); // ย้ายไปท้าย = ห้องที่เพิ่งมีคนคุย
  buffers.set(key, lines.slice(-CONTEXT_SIZE));
  if (buffers.size > MAX_CHANNELS) buffers.delete(buffers.keys().next().value!);
}

/** บริบทของข้อความนี้ (ต้องเรียกก่อน rememberMessage ของข้อความเดียวกัน) */
export async function contextFor(message: Message, now = Date.now()): Promise<ChatContext> {
  const recent = (buffers.get(message.channelId) ?? []).filter(
    (l) => now - l.at <= CONTEXT_WINDOW_MS && l.id !== message.id,
  );

  let replyTo: ChatContext["replyTo"];
  const refId = message.reference?.messageId;
  if (refId) {
    const inBuffer = recent.find((l) => l.id === refId);
    if (inBuffer) {
      replyTo = { author: inBuffer.author, text: inBuffer.text };
    } else {
      // ตอบข้อความเก่าที่ไม่ได้จำไว้ — ดึงจาก Discord เฉพาะกรณีนี้
      const ref = await message.fetchReference().catch(() => null);
      if (ref?.content) replyTo = { author: nameOf(ref), text: cleanText(ref.content) };
    }
  }

  const mentions = [...(message.mentions?.users?.values() ?? [])]
    .filter((u) => u.id !== message.author.id)
    .map((u) => cleanName(message.guild?.members.cache.get(u.id)?.displayName ?? u.globalName ?? u.username));

  const channel =
    message.channel && "name" in message.channel && message.channel.name ? `#${message.channel.name}` : "";
  return { channel, author: nameOf(message), recent, replyTo, mentions };
}

/** เนื้อหาที่ส่งให้ Claude: บริบท (ถ้ามี) + ข้อความที่ต้องตัดสิน */
export function renderForClaude(text: string, ctx?: ChatContext): string {
  text = cleanText(text, Infinity);
  if (!ctx) return `<message>\n${text}\n</message>`;
  const parts: string[] = [];
  if (ctx.recent.length) {
    parts.push(
      `<context${ctx.channel ? ` channel="${cleanName(ctx.channel)}"` : ""}>`,
      "ข้อความก่อนหน้าในห้อง (เก่า → ใหม่):",
      ...ctx.recent.map((l) => `[${l.author}] ${l.text}`),
      "</context>",
    );
  }
  if (ctx.replyTo) {
    parts.push(`<reply_to author="${ctx.replyTo.author}">\n${ctx.replyTo.text}\n</reply_to>`);
  }
  const mentions = ctx.mentions.length ? ` mentions="${ctx.mentions.join(", ")}"` : "";
  parts.push(`<message author="${ctx.author}"${mentions}>\n${text}\n</message>`);
  return parts.join("\n");
}

/**
 * บริบทจากกล่องทดสอบ Claude บนหน้าตั้งค่า — บรรทัดละข้อความ "ชื่อ: ข้อความ" (เก่า → ใหม่)
 * ข้อความที่ทดสอบถือว่า "ผู้พิมพ์" เป็นคนพิมพ์
 */
export function contextFromLines(raw: string, author = "ผู้พิมพ์"): ChatContext {
  const recent = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-CONTEXT_SIZE)
    .map((l, i) => {
      const m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(l);
      return { id: `test-${i}`, author: cleanName(m ? m[1]! : "ไม่ทราบชื่อ"), text: cleanText(m ? m[2]! : l), at: 0 };
    });
  return { channel: "", author, recent, mentions: [] };
}

/** ใช้ในเทส */
export function __clearContext(): void {
  buffers.clear();
}
