import { config } from "../config.js";

/**
 * แจ้งเหตุการณ์ความปลอดภัยเข้า Discord webhook (ช่องเดียวกับสถานะเครื่อง)
 *
 * dedupe ต่อชนิดเหตุการณ์: ไม่เกิน 1 ข้อความ/นาที — จุดนี้สำคัญกว่าที่เห็น
 * ถ้าไม่ dedupe ผู้โจมตียิงรัว ๆ จะเปลี่ยน "ระบบแจ้งเตือน" เป็นเครื่องมือสแปมช่อง
 * ของเราเอง (alert fatigue = มองข้ามของจริง)
 *
 * นับสถิติ 24 ชม. ไว้ด้วย (in-memory) — เผื่อ heartbeat รายวันดึงไปโชว์
 */
const COOLDOWN_MS = 60_000;
const lastSent = new Map<string, number>();

const counts = new Map<string, number>();
let countsResetAt = 0;

/** สถิติเหตุการณ์ตั้งแต่รีเซ็ตล่าสุด (heartbeat เรียกใช้แล้วรีเซ็ตเองได้) */
export function securityCounts(reset = false): Record<string, number> {
  const out = Object.fromEntries(counts);
  if (reset) {
    counts.clear();
    countsResetAt = Date.now();
  }
  return out;
}

export function securityCountsSince(): number {
  return countsResetAt;
}

/**
 * ส่งแจ้งเตือน 1 เหตุการณ์ — `kind` ใช้ทั้งเป็นหัวข้อและคีย์ dedupe
 * ไม่ throw ออกไปเด็ดขาด (ระบบแจ้งเตือนล่มต้องไม่พาเว็บล่มตาม)
 */
export async function notifySecurity(kind: string, detail: string): Promise<void> {
  counts.set(kind, (counts.get(kind) ?? 0) + 1);

  const url = config.status.webhookUrl;
  if (!url) return; // ไม่ได้ตั้ง webhook = นับสถิติอย่างเดียว
  const now = Date.now();
  if (now - (lastSent.get(kind) ?? 0) < COOLDOWN_MS) return;
  lastSent.set(kind, now);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `🛡️ ${kind}`.slice(0, 256),
            description: detail.slice(0, 1000),
            color: 0xe01e5a,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("ส่งแจ้งเตือนความปลอดภัยไม่สำเร็จ:", err);
  }
}
