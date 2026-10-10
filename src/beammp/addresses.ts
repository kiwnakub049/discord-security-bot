import { networkInterfaces } from "node:os";

/**
 * ที่อยู่ที่ใช้เข้าเซิร์ฟเกมได้ — คิดจาก network interface จริงของเครื่อง
 *
 * ไม่ฮาร์ดโค้ด IP เพราะ IP ในวง LAN มาจาก DHCP ของเราเตอร์ ซึ่งเปลี่ยนได้ทุกครั้ง
 * ที่ไฟดับหรือเราเตอร์รีบูต ถ้าเขียนตายไว้แล้วมันเปลี่ยน คนจะกดเข้าไม่ได้
 * โดยที่หน้าเว็บยังโชว์เลขเดิมอย่างมั่นใจ
 */

export interface JoinAddress {
  /** "lan" | "tailscale" — ใช้เลือกข้อความอธิบายให้ผู้ใช้ */
  kind: "lan" | "tailscale";
  host: string;
  label: string;
}

/** Tailscale แจก IP ในช่วง 100.64.0.0/10 (CGNAT) — แยกออกจาก LAN ปกติได้จากช่วงนี้ */
function isTailscale(ip: string): boolean {
  const m = /^100\.(\d+)\./.exec(ip);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 64 && second <= 127;
}

export function joinAddresses(): JoinAddress[] {
  const out: JoinAddress[] = [];
  /*
   * networkInterfaces() โยน error ได้ถ้า sandbox ปิด AF_NETLINK ไว้ (เจอมาแล้ว)
   * ถ้าปล่อยให้หลุดขึ้นไป หน้าสถานะทั้งหน้าจะพัง ทั้งที่ขาดแค่รายการที่อยู่
   * — คืนรายการว่างแล้วให้ส่วนอื่นทำงานต่อดีกว่า
   */
  let ifaces: ReturnType<typeof networkInterfaces>;
  try {
    ifaces = networkInterfaces();
  } catch {
    return out;
  }
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (isTailscale(a.address)) {
        out.push({ kind: "tailscale", host: a.address, label: "ผ่าน Tailscale" });
      } else {
        out.push({ kind: "lan", host: a.address, label: `ในบ้าน (${name})` });
      }
    }
  }
  // LAN ขึ้นก่อนเสมอ — เป็นทางที่คนส่วนใหญ่ใช้ และเร็วกว่า
  return out.sort((a, b) => (a.kind === "lan" ? -1 : 1) - (b.kind === "lan" ? -1 : 1));
}
