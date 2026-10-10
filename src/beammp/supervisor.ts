import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { paths } from "./paths.js";
import { hasAuthKey, readConfigFile } from "./serverConfig.js";

/**
 * ตัวคุมโปรเซส BeamMP-Server
 *
 * ── ทำไมไม่ใช้ systemd คุมเซิร์ฟเกมโดยตรง ──
 * dashboard รันอยู่ใน service ที่ตั้ง NoNewPrivileges=true ไว้ ทำให้เรียก sudo ไม่ได้เลย
 * (ตรวจแล้ว: sudo ตอบว่า "no new privileges flag is set") และ ProtectHome=tmpfs
 * ทำให้มองไม่เห็นโฟลเดอร์เกมด้วยซ้ำ
 * ทางเลือกคือปลดเกราะพวกนั้นออก ซึ่งจะทำให้ช่องโหว่ในบอทลามไปทั้งเครื่องได้
 * เลยแยกเป็น agent ตัวเล็กที่ถือสิทธิ์เฉพาะโฟลเดอร์เกม แล้วให้ dashboard สั่งผ่าน
 * 127.0.0.1 แทน — เกราะของบอทยังอยู่ครบ
 */

/** จำนวนบรรทัด log ที่เก็บไว้ให้คนเปิดหน้าเว็บทีหลังเห็นย้อนหลังได้ */
const LOG_BUFFER = 400;
/** รอเท่านี้หลังส่ง SIGTERM ก่อนจะบังคับฆ่า */
const KILL_AFTER_MS = 10_000;

export type State = "stopped" | "starting" | "running" | "stopping";

export interface Status {
  state: State;
  pid: number | null;
  /** เริ่มรันเมื่อไหร่ (epoch ms) — null ถ้าไม่ได้รัน */
  startedAt: number | null;
  /** รหัสจบของรอบที่แล้ว ใช้บอกว่าเพิ่งพังไปหรือเราสั่งปิดเอง */
  lastExit: { code: number | null; signal: string | null; at: number } | null;
  hasAuthKey: boolean;
  binaryExists: boolean;
}

export interface LogLine {
  at: number;
  text: string;
}

export class Supervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: State = "stopped";
  private startedAt: number | null = null;
  private lastExit: Status["lastExit"] = null;
  private buffer: LogLine[] = [];
  /** เศษบรรทัดจาก chunk ก่อนหน้า — stdout ไม่ได้มาเป็นบรรทัดพอดีเสมอ */
  private partial = "";

  status(): Status {
    let auth = false;
    try {
      auth = hasAuthKey(readConfigFile(paths.config));
    } catch {
      auth = false; // ไม่มีไฟล์ตั้งค่า = ยังไม่ได้ตั้ง
    }
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      hasAuthKey: auth,
      binaryExists: existsSync(paths.binary),
    };
  }

  recentLogs(): LogLine[] {
    return [...this.buffer];
  }

  private push(text: string): void {
    const line: LogLine = { at: Date.now(), text };
    this.buffer.push(line);
    if (this.buffer.length > LOG_BUFFER) this.buffer.shift();
    this.emit("log", line);
  }

  private setState(s: State): void {
    this.state = s;
    this.emit("status", this.status());
  }

  /** แยก chunk ที่ได้จาก stdout ออกเป็นบรรทัด */
  private ingest(chunk: Buffer): void {
    this.partial += chunk.toString("utf8");
    const parts = this.partial.split("\n");
    this.partial = parts.pop() ?? "";
    for (const p of parts) {
      const text = p.replace(/\r$/, "");
      if (text.trim().length > 0) this.push(text);
    }
  }

  start(): { ok: boolean; error?: string } {
    if (this.child) return { ok: false, error: "เซิร์ฟเวอร์รันอยู่แล้ว" };
    if (!existsSync(paths.binary))
      return { ok: false, error: "ไม่พบไฟล์ BeamMP-Server" };
    if (!this.status().hasAuthKey)
      return { ok: false, error: "ยังไม่ได้ตั้ง AuthKey ใน ServerConfig.toml" };

    this.setState("starting");
    this.push("— สั่งเปิดเซิร์ฟเวอร์ —");

    const child = spawn(paths.binary, [], {
      cwd: paths.dir,
      stdio: ["ignore", "pipe", "pipe"],
      // ไม่ส่ง env ของ agent ต่อไปทั้งก้อน — เซิร์ฟเกมไม่ควรเห็นโทเคนของเรา
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: paths.dir },
    });
    this.child = child;
    this.startedAt = Date.now();
    this.writeDesired("running");

    child.stdout?.on("data", (c: Buffer) => this.ingest(c));
    child.stderr?.on("data", (c: Buffer) => this.ingest(c));

    child.on("spawn", () => this.setState("running"));

    child.on("error", (err) => {
      this.push(`เปิดไม่สำเร็จ: ${err.message}`);
      this.child = null;
      this.startedAt = null;
      this.setState("stopped");
    });

    child.on("exit", (code, signal) => {
      this.push(`— เซิร์ฟเวอร์หยุดแล้ว (code=${code} signal=${signal}) —`);
      this.lastExit = { code, signal, at: Date.now() };
      this.child = null;
      this.startedAt = null;
      this.partial = "";
      this.setState("stopped");
    });

    return { ok: true };
  }

  /**
   * @param remember true = คนสั่งปิดเอง (หลังรีบูตจะไม่เปิดให้)
   *                 false = agent กำลังปิดตัวเอง เช่นตอน deploy — ต้องคงสถานะเดิมไว้
   *                 ไม่งั้นรีสตาร์ท agent ทีเดียวแล้วเซิร์ฟเกมจะไม่กลับมาเองอีกเลย
   */
  async stop(remember = true): Promise<{ ok: boolean; error?: string }> {
    const child = this.child;
    if (!child) return { ok: false, error: "เซิร์ฟเวอร์ไม่ได้รันอยู่" };
    this.setState("stopping");
    this.push("— สั่งปิดเซิร์ฟเวอร์ —");
    if (remember) this.writeDesired("stopped");

    await new Promise<void>((resolve) => {
      /*
       * SIGTERM ให้โอกาสเซิร์ฟบอกลาผู้เล่นและเซฟก่อน
       * ถ้าไม่ยอมตายใน 10 วิ ค่อย SIGKILL — ไม่งั้น agent จะค้างรอตลอดกาล
       */
      const timer = setTimeout(() => {
        this.push("ปิดปกติไม่สำเร็จใน 10 วินาที — บังคับปิด");
        child.kill("SIGKILL");
      }, KILL_AFTER_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
    return { ok: true };
  }

  async restart(): Promise<{ ok: boolean; error?: string }> {
    if (this.child) await this.stop(false); // ปลายทางคือ "เปิดอยู่" อย่าเผลอจำว่าปิด
    return this.start();
  }

  /** อ่านรายชื่อผู้เล่นที่ปลั๊กอิน Lua เขียนไว้ */
  players(): { count: number; players: unknown[]; stale: boolean } | null {
    if (this.state !== "running") return null;
    try {
      const raw = JSON.parse(readFileSync(paths.status, "utf8")) as {
        at?: number;
        count?: number;
        players?: unknown;
      };
      /*
       * Lua เข้ารหัสตารางว่างเป็น {} ไม่ใช่ [] (ยืนยันจากไฟล์จริงตอนไม่มีคนเล่น)
       * ตอนมีคนเล่นน่าจะได้ [] เพราะคีย์เป็น 1..n แต่ "น่าจะ" ไม่พอ —
       * ถ้าเดาผิดจะโชว์ 0 คนทั้งที่ count บอกว่ามีคนอยู่ รับทั้งสองแบบไปเลย
       */
      const list = Array.isArray(raw.players)
        ? raw.players
        : raw.players && typeof raw.players === "object"
          ? Object.values(raw.players as Record<string, unknown>)
          : [];
      /*
       * ปลั๊กอินเขียนทุก 2 วินาที ถ้าไฟล์เก่ากว่า 15 วิ แปลว่าปลั๊กอินไม่ทำงาน
       * (ถูกลบ / เซิร์ฟโหลด Resources ไม่ผ่าน) — บอกว่าข้อมูลเก่า ดีกว่าโชว์เลขผิด
       */
      const at = typeof raw.at === "number" ? raw.at * 1000 : 0;
      return {
        count: typeof raw.count === "number" ? raw.count : 0,
        players: list,
        stale: Date.now() - at > 15_000,
      };
    } catch {
      return null; // ยังไม่มีไฟล์ = เซิร์ฟเพิ่งขึ้น ปลั๊กอินยังไม่ได้เขียนรอบแรก
    }
  }

  private writeDesired(v: "running" | "stopped"): void {
    try {
      writeFileSync(paths.desired, v);
    } catch {
      // เขียนไม่ได้ก็แค่ไม่เปิดต่อให้เองหลังรีบูต ไม่ใช่เรื่องคอขาดบาดตาย
    }
  }

  /** ตอน agent เพิ่งขึ้น: ถ้าก่อนหน้านี้เซิร์ฟเปิดอยู่ ให้เปิดต่อ */
  resumeIfWanted(): void {
    try {
      if (readFileSync(paths.desired, "utf8").trim() === "running") {
        this.push("— เปิดต่อจากสถานะก่อนรีบูต —");
        this.start();
      }
    } catch {
      // ไม่มีไฟล์ = ไม่เคยสั่งเปิด
    }
  }
}
