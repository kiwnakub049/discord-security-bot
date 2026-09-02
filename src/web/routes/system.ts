/**
 * สถานะเครื่องที่บอทรันอยู่ — อุณหภูมิ, RAM, ดิสก์, พัดลม, ไฟตก/throttle
 *
 * อ่านจาก sysfs เป็นหลักเพราะเป็นไฟล์เล็ก ๆ อ่านเร็วมากและไม่ต้อง spawn อะไร
 * ยกเว้นบิต "เคยโดน throttle ตั้งแต่บูต" ที่มีแต่ vcgencmd รู้ — ตัวนั้น cache ไว้
 */
import { Router, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statfs } from "node:fs";
import { promisify } from "node:util";
import { cpus, freemem, loadavg, totalmem, uptime } from "node:os";
import { disabledFeatures, privilegedDisabled } from "../../intents.js";

const execFileAsync = promisify(execFile);
const statfsAsync = promisify(statfs);

/** อ่านไฟล์ sysfs เป็นตัวเลข — คืน null ถ้าไม่มีไฟล์นั้นบนเครื่องนี้ */
function readNum(path: string): number | null {
  try {
    const n = Number(readFileSync(path, "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * หา hwmon ตามชื่อ ไม่ใช่ตามเลข index
 * เลข hwmonN สลับกันได้ทุกครั้งที่บูต ขึ้นกับว่า driver ตัวไหน probe เสร็จก่อน
 * เคยเจอมาแล้วกับสคริปต์จอ OLED — จำ index ไว้แล้วอ่านผิดตัว
 */
function hwmonPath(name: string, file: string): string | null {
  try {
    for (const dir of readdirSync("/sys/class/hwmon")) {
      const base = `/sys/class/hwmon/${dir}`;
      try {
        if (readFileSync(`${base}/name`, "utf8").trim() === name) {
          return `${base}/${file}`;
        }
      } catch {
        /* hwmon ตัวนี้ไม่มีไฟล์ name — ข้าม */
      }
    }
  } catch {
    /* ไม่ใช่ Linux หรือไม่มี hwmon เลย */
  }
  return null;
}

/** MemAvailable ของเคอร์เนล แม่นกว่า freemem() เพราะรวม cache ที่คืนได้ */
function memAvailableKb(): number | null {
  try {
    const m = /^MemAvailable:\s+(\d+) kB$/m.exec(
      readFileSync("/proc/meminfo", "utf8"),
    );
    return m?.[1] ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export interface ThrottleFlags {
  raw: string;
  /** ไฟตกอยู่ตอนนี้ */
  underVoltageNow: boolean;
  /** ถูกลดความเร็วอยู่ตอนนี้ */
  throttledNow: boolean;
  /** ชนเพดานอุณหภูมิอยู่ตอนนี้ */
  tempLimitNow: boolean;
  /** เคยเกิดตั้งแต่บูตครั้งล่าสุด (บิตบนค้างไว้จนกว่าจะรีบูต) */
  underVoltagePast: boolean;
  throttledPast: boolean;
  tempLimitPast: boolean;
}

// vcgencmd ต้อง spawn process จริง ๆ อย่ายิงทุก request — หน้าเว็บ poll ทุกไม่กี่วินาที
let throttleCache: { at: number; value: ThrottleFlags | null } = {
  at: 0,
  value: null,
};

async function readThrottle(): Promise<ThrottleFlags | null> {
  if (Date.now() - throttleCache.at < 5_000) return throttleCache.value;
  let value: ThrottleFlags | null = null;
  try {
    const { stdout } = await execFileAsync("vcgencmd", ["get_throttled"], {
      timeout: 2_000,
    });
    const hex = /throttled=0x([0-9a-fA-F]+)/.exec(stdout)?.[1];
    if (hex) {
      const bits = parseInt(hex, 16);
      value = {
        raw: `0x${hex}`,
        underVoltageNow: Boolean(bits & (1 << 0)),
        throttledNow: Boolean(bits & (1 << 2)),
        tempLimitNow: Boolean(bits & (1 << 3)),
        underVoltagePast: Boolean(bits & (1 << 16)),
        throttledPast: Boolean(bits & (1 << 18)),
        tempLimitPast: Boolean(bits & (1 << 19)),
      };
    }
  } catch {
    // ไม่ใช่ Pi หรือไม่มีสิทธิ์เข้า /dev/vcio — ปล่อยเป็น null ให้หน้าเว็บซ่อนส่วนนี้
  }
  throttleCache = { at: Date.now(), value };
  return value;
}

export function systemRoutes(): Router {
  const r = Router();

  r.get("/api/system", async (_req: Request, res: Response) => {
    const tempPath = hwmonPath("cpu_thermal", "temp1_input");
    const fanPath = hwmonPath("pwmfan", "fan1_input");
    // in0_lcrit_alarm = สัญญาณไฟตกแบบสด ๆ ที่ไม่ต้อง spawn vcgencmd
    const lcritPath = hwmonPath("rpi_volt", "in0_lcrit_alarm");

    const tempMilli = tempPath ? readNum(tempPath) : null;
    const freqKhz = readNum("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq");
    const maxKhz = readNum("/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq");
    const availKb = memAvailableKb();
    const total = totalmem();
    const available = availKb !== null ? availKb * 1024 : freemem();

    let disk: { totalGb: number; freeGb: number; usedPct: number } | null = null;
    try {
      const fs = await statfsAsync("/");
      const totalB = fs.blocks * fs.bsize;
      const freeB = fs.bavail * fs.bsize; // bavail = ที่ว่างสำหรับ user ธรรมดา (ไม่นับโควตาสำรองของ root)
      disk = {
        totalGb: +(totalB / 1e9).toFixed(1),
        freeGb: +(freeB / 1e9).toFixed(1),
        usedPct: Math.round(((totalB - freeB) / totalB) * 100),
      };
    } catch {
      /* อ่าน filesystem ไม่ได้ */
    }

    res.json({
      cpu: {
        tempC: tempMilli !== null ? +(tempMilli / 1000).toFixed(1) : null,
        freqMhz: freqKhz !== null ? Math.round(freqKhz / 1000) : null,
        maxFreqMhz: maxKhz !== null ? Math.round(maxKhz / 1000) : null,
        cores: cpus().length,
        load: loadavg().map((n) => +n.toFixed(2)),
      },
      memory: {
        totalMb: Math.round(total / 1048576),
        availableMb: Math.round(available / 1048576),
        usedPct: Math.round(((total - available) / total) * 100),
      },
      disk,
      fanRpm: fanPath ? readNum(fanPath) : null,
      power: {
        ...(await readThrottle()),
        // อ่านสดทุกครั้ง ไม่ผ่าน cache — อันนี้เป็นไฟล์ sysfs ธรรมดา ถูกมาก
        lowVoltageAlarm: lcritPath ? readNum(lcritPath) === 1 : null,
      },
      // โหมดจำกัดสิทธิ์ — ต้องเห็นบนหน้าเว็บ ไม่ใช่ซ่อนอยู่ใน log ตอนบูตอย่างเดียว
      // การป้องกันหายไปหลายชั้นแล้วไม่มีใครรู้ คือสภาพที่แย่กว่าบอทดับไปเลย
      degraded: privilegedDisabled ? disabledFeatures : null,
      uptime: {
        hostSec: Math.round(uptime()),
        botSec: Math.round(process.uptime()),
      },
      process: {
        rssMb: Math.round(process.memoryUsage.rss() / 1048576),
        node: process.version,
      },
    });
  });

  return r;
}
