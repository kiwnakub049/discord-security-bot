import { AGENT_URL } from "./paths.js";
import type { JoinAddress } from "./addresses.js";

/**
 * ตัวเรียก agent — ใช้ร่วมกันระหว่างหน้าเว็บกับคำสั่งใน Discord
 *
 * แยกออกมาเพราะทั้งสองทางต้องการข้อมูลชุดเดียวกัน ถ้าต่างคนต่างเขียน
 * เวลาแก้รูปแบบข้อมูลจะลืมแก้อีกฝั่ง แล้วจะเพี้ยนเฉพาะทางใดทางหนึ่งโดยไม่มีใครเห็น
 */

export interface AgentStatus {
  state: "stopped" | "starting" | "running" | "stopping";
  pid: number | null;
  startedAt: number | null;
  hasAuthKey: boolean;
  binaryExists: boolean;
  players: { count: number; players: PlayerInfo[]; stale: boolean } | null;
  port: number;
  addresses: JoinAddress[];
}

export interface PlayerInfo {
  id: number;
  name: string;
  guest: boolean;
  cars: number;
}

function token(): string {
  return process.env.BEAMMP_AGENT_TOKEN ?? "";
}

/**
 * ถามสถานะจาก agent
 * @returns null ถ้า agent ไม่ตอบ (service ไม่ได้รัน) — ผู้เรียกตัดสินใจเองว่าจะแสดงอะไร
 */
export async function fetchStatus(): Promise<AgentStatus | null> {
  try {
    const res = await fetch(`${AGENT_URL}/status`, {
      headers: { "x-agent-token": token() },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as AgentStatus;
  } catch {
    return null;
  }
}

/** ค่าตั้งที่โชว์ได้ (ไม่มี AuthKey) — ใช้ดึงชื่อเซิร์ฟกับแผนที่มาแสดง */
export async function fetchConfig(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${AGENT_URL}/config`, {
      headers: { "x-agent-token": token() },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { values?: Record<string, unknown> };
    return body.values ?? null;
  } catch {
    return null;
  }
}
