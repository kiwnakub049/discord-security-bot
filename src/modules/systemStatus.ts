import { readFile, readdir } from "node:fs/promises";
import { cpus } from "node:os";
import { config } from "../config.js";
import { db } from "../store/db.js";

/**
 * ส่งสถานะเครื่องแบบย่อเข้า Discord ผ่าน webhook เป็นระยะ (คล้าย Netdata แต่ไม่ลงลึก)
 * + แนบลิงก์นำทางไปเว็บที่ host อยู่
 *
 * อ่านค่าจาก /proc, /sys ตรง ๆ (ไม่เรียก subprocess) แล้ว "แก้ข้อความเดิม" ทุกงวด
 * เพื่อไม่ให้สแปมห้อง — เก็บ message id ไว้ใน bot_kv (รอด restart)
 */

const KV_KEY = "status_message_id";

function kvGet(k: string): string | null {
  const row = db.prepare("SELECT v FROM bot_kv WHERE k = ?").get(k) as
    | { v: string }
    | undefined;
  return row?.v ?? null;
}
function kvSet(k: string, v: string): void {
  db.prepare(
    "INSERT INTO bot_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = ?",
  ).run(k, v, v);
}
function kvDel(k: string): void {
  db.prepare("DELETE FROM bot_kv WHERE k = ?").run(k);
}

interface Metrics {
  loadPct: number; // โหลด CPU 1 นาที เทียบจำนวนคอร์ (%)
  load1: number;
  cores: number;
  memUsedPct: number;
  memUsedGb: number;
  memTotalGb: number;
  tempC: number | null;
  uptimeSec: number;
  underVolt: boolean;
}

async function readNum(path: string): Promise<number | null> {
  try {
    return Number((await readFile(path, "utf8")).trim());
  } catch {
    return null;
  }
}

/** under-voltage ตอนนี้ไหม — อ่าน in0_lcrit_alarm ของ hwmon ชื่อ rpi_volt (เลข hwmonX สลับได้) */
async function readUnderVolt(): Promise<boolean> {
  try {
    const base = "/sys/class/hwmon";
    for (const dir of await readdir(base)) {
      const name = await readFile(`${base}/${dir}/name`, "utf8").catch(() => "");
      if (name.trim() === "rpi_volt") {
        return (await readNum(`${base}/${dir}/in0_lcrit_alarm`)) === 1;
      }
    }
  } catch {
    // ไม่ใช่ Pi / ไม่มี hwmon ตัวนี้ — ถือว่าปกติ
  }
  return false;
}

async function readMetrics(): Promise<Metrics> {
  const cores = cpus().length || 1;

  const loadavg = await readFile("/proc/loadavg", "utf8").catch(() => "0");
  const load1 = Number(loadavg.split(/\s+/)[0]) || 0;

  const meminfo = await readFile("/proc/meminfo", "utf8").catch(() => "");
  const kb = (key: string): number => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(meminfo);
    return m ? Number(m[1]) : 0;
  };
  const memTotal = kb("MemTotal");
  const memAvail = kb("MemAvailable");
  const memUsed = Math.max(0, memTotal - memAvail);

  const tempRaw = await readNum("/sys/class/thermal/thermal_zone0/temp");
  const uptime = await readFile("/proc/uptime", "utf8").catch(() => "0");

  return {
    load1,
    cores,
    loadPct: Math.round((load1 / cores) * 100),
    memUsedPct: memTotal ? Math.round((memUsed / memTotal) * 100) : 0,
    memUsedGb: memUsed / 1024 / 1024,
    memTotalGb: memTotal / 1024 / 1024,
    tempC: tempRaw != null ? tempRaw / 1000 : null,
    uptimeSec: Number(uptime.split(/\s+/)[0]) || 0,
    underVolt: await readUnderVolt(),
  };
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} วัน ${h} ชม.`;
  if (h) return `${h} ชม. ${m} นาที`;
  return `${m} นาที`;
}

/** สร้าง embed สถานะแบบย่อ (payload ตรง ๆ สำหรับ webhook) */
function buildEmbed(m: Metrics): Record<string, unknown> {
  // แดง = ไฟตกหรือร้อนจัด, เหลือง = โหลด/แรมสูง, เขียว = ปกติ
  const hot = m.tempC != null && m.tempC >= 75;
  const busy = m.loadPct >= 85 || m.memUsedPct >= 90;
  const color = m.underVolt || hot ? 0xed4245 : busy ? 0xfee75c : 0x57f287;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "CPU", value: `${m.loadPct}% _(load ${m.load1.toFixed(2)}/${m.cores})_`, inline: true },
    { name: "RAM", value: `${m.memUsedPct}% _(${m.memUsedGb.toFixed(1)}/${m.memTotalGb.toFixed(1)} GB)_`, inline: true },
    {
      name: "อุณหภูมิ",
      value: m.tempC != null ? `${m.tempC.toFixed(1)}°C` : "—",
      inline: true,
    },
    { name: "Uptime", value: fmtUptime(m.uptimeSec), inline: true },
  ];
  if (m.underVolt) {
    fields.push({ name: "⚡ ไฟตก", value: "under-voltage กำลังเกิด — เช็คอะแดปเตอร์", inline: false });
  }

  const links = config.status.links
    .filter((l) => l.url)
    .map((l) => `[${l.name}](${l.url})`)
    .join(" · ");
  if (links) fields.push({ name: "เว็บ", value: links, inline: false });

  return {
    title: "🖥️ สถานะเครื่อง",
    color,
    fields,
    footer: { text: "อัปเดตอัตโนมัติ" },
    timestamp: new Date().toISOString(),
  };
}

/** POST สร้างข้อความใหม่ผ่าน webhook แล้วคืน message id (null ถ้าล้มเหลว) */
async function postNew(embed: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`${config.status.webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch (err) {
    console.error("ส่งสถานะเครื่อง (webhook POST) ไม่สำเร็จ:", err);
    return null;
  }
}

/** PATCH แก้ข้อความเดิม — คืน true ถ้าสำเร็จ, false ถ้าข้อความหาย (ให้ POST ใหม่) */
async function editExisting(
  messageId: string,
  embed: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${config.status.webhookUrl}/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 404) return false; // ข้อความถูกลบ → ให้ผู้เรียก POST ใหม่
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error("อัปเดตสถานะเครื่อง (webhook PATCH) ไม่สำเร็จ:", err);
    return true; // error ชั่วคราว — เก็บ id ไว้ ลองใหม่งวดหน้า
  }
}

async function tick(): Promise<void> {
  const embed = buildEmbed(await readMetrics());
  const existing = kvGet(KV_KEY);
  if (existing) {
    const ok = await editExisting(existing, embed);
    if (ok) return;
    kvDel(KV_KEY); // ข้อความหาย → ล้างแล้วสร้างใหม่
  }
  const id = await postNew(embed);
  if (id) kvSet(KV_KEY, id);
}

/**
 * เริ่มลูปส่งสถานะเครื่อง — เรียกครั้งเดียวตอนบอทออนไลน์
 * ปิดเงียบถ้าไม่ได้ตั้ง enabled หรือไม่มี webhook URL
 */
export function startSystemStatus(): void {
  if (!config.status.enabled || !config.status.webhookUrl) {
    if (config.status.enabled) {
      console.warn(
        "ℹ️  ระบบสถานะเครื่องเปิดอยู่แต่ยังไม่ได้ตั้ง STATUS_WEBHOOK_URL ใน .env — ข้ามไป",
      );
    }
    return;
  }
  void tick(); // ส่งทันทีรอบแรก ไม่ต้องรอครบ interval
  setInterval(() => void tick(), config.status.intervalMs).unref();
}
