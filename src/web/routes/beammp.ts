/**
 * แผงคุมเซิร์ฟเวอร์ BeamNG (BeamMP) — เห็นเฉพาะเจ้าของเครื่อง
 *
 * ทุกเส้นทางในไฟล์นี้เป็นแค่ตัวส่งต่อไปหา agent ที่ 127.0.0.1
 * ตัว dashboard เองแตะโฟลเดอร์เกมไม่ได้ (service ถูกล็อกไว้ด้วย ProtectHome)
 * ดูเหตุผลเต็มใน src/beammp/supervisor.ts
 */
import { Router, type Request, type Response } from "express";
import { Readable } from "node:stream";
import { AGENT_URL } from "../../beammp/paths.js";
import { requireOwner } from "../middleware/auth.js";
import { logEvent } from "../../utils/logger.js";
import type { Client } from "discord.js";

const TOKEN = process.env.BEAMMP_AGENT_TOKEN ?? "";

/** RequestInit + สองอย่างที่ Node ต้องใช้เวลาส่ง body เป็นสตรีม */
type AgentInit = RequestInit & { duplex?: "half"; timeoutMs?: number };

/** ยิงไปหา agent — รวม header โทเคนกับการแปลง error ให้เป็นข้อความไทยไว้ที่เดียว */
async function callAgent(
  path: string,
  init: AgentInit = {},
): Promise<{ status: number; body: unknown }> {
  const { timeoutMs, ...rest } = init;
  try {
    const res = await fetch(`${AGENT_URL}${path}`, {
      ...rest,
      headers: { ...(rest.headers ?? {}), "x-agent-token": TOKEN },
      // ปิดเซิร์ฟเกมอาจใช้เวลาถึง 10 วิ (รอ SIGTERM) — เผื่อไว้ 20
      signal: AbortSignal.timeout(timeoutMs ?? 20_000),
    } as RequestInit);
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    /*
     * agent ไม่ตอบ = service ไม่ได้รันอยู่ หรือยังไม่ได้ติดตั้ง
     * บอกให้ชัดว่าเป็นตัวกลางที่ล่ม ไม่ใช่ตัวเซิร์ฟเกม จะได้ไปดูถูกที่
     */
    return {
      status: 503,
      body: { error: "ต่อ agent ไม่ได้ — เช็ค: systemctl status beammp-agent" },
    };
  }
}

function pass(res: Response, r: { status: number; body: unknown }): void {
  res.status(r.status).json(r.body);
}

export function beammpRoutes(client?: Client): Router {
  const r = Router();
  r.use("/api/beammp", requireOwner);

  r.get("/api/beammp/status", async (_req, res) => {
    pass(res, await callAgent("/status"));
  });

  /* คำสั่งที่เปลี่ยนสถานะเครื่อง — บันทึกทุกครั้งว่าใครสั่งเมื่อไหร่ */
  for (const action of ["start", "stop", "restart"] as const) {
    r.post(`/api/beammp/${action}`, async (_req: Request, res: Response) => {
      const out = await callAgent(`/${action}`, { method: "POST" });
      const label = { start: "เปิด", stop: "ปิด", restart: "รีสตาร์ท" }[action];
      if (client) {
        await logEvent(client, "info", "system", `beammp_${action}`, `${label}เซิร์ฟเวอร์ BeamNG`, [
          { name: "ผู้ทำ", value: String(res.locals.username) },
          { name: "ผลลัพธ์", value: out.status === 200 ? "สำเร็จ" : `ไม่สำเร็จ (${out.status})` },
        ]);
      }
      pass(res, out);
    });
  }

  r.get("/api/beammp/config", async (_req, res) => {
    pass(res, await callAgent("/config"));
  });

  r.put("/api/beammp/config", async (req, res) => {
    const out = await callAgent("/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
    });
    if (client && out.status === 200) {
      await logEvent(client, "info", "system", "beammp_config", "แก้ตั้งค่าเซิร์ฟเวอร์ BeamNG", [
        { name: "ผู้ทำ", value: String(res.locals.username) },
        { name: "ค่าที่แก้", value: Object.keys((req.body ?? {}) as object).join(", ") || "-" },
      ]);
    }
    pass(res, out);
  });

  r.get("/api/beammp/logs", async (_req, res) => {
    pass(res, await callAgent("/logs"));
  });

  /* log สด — ต่อ SSE ของ agent แล้วส่งต่อให้เบราว์เซอร์ตรง ๆ */
  r.get("/api/beammp/logs/stream", async (req: Request, res: Response) => {
    const ctrl = new AbortController();
    req.on("close", () => ctrl.abort());
    try {
      const upstream = await fetch(`${AGENT_URL}/logs/stream`, {
        headers: { "x-agent-token": TOKEN },
        signal: ctrl.signal,
      });
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: "agent ไม่ตอบสตรีม" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // ปิด buffer ของ proxy ไม่งั้นบรรทัด log จะมาเป็นก้อนแทนที่จะไหลทีละบรรทัด
        "X-Accel-Buffering": "no",
      });
      for await (const chunk of upstream.body) res.write(chunk);
    } catch {
      // ผู้ใช้ปิดแท็บ หรือ agent ตัดสาย — ปิดฝั่งเราให้เรียบร้อยพอ
    } finally {
      res.end();
    }
  });

  r.get("/api/beammp/levels", async (_req, res) => {
    pass(res, await callAgent("/levels"));
  });

  r.get("/api/beammp/mods", async (_req, res) => {
    pass(res, await callAgent("/mods"));
  });

  /*
   * อัปโหลดแบบซอยก้อน — begin / chunk / finish
   *
   * ทำไมไม่ส่งรวดเดียว: เว็บวิ่งผ่าน Cloudflare Tunnel ซึ่งแผนฟรีตัด body ที่ 100 MiB
   * (วัดแล้ว 104,857,600 bytes ขึ้นไปได้ 413 จากขอบของ Cloudflare ตั้งแต่ยังไม่ถึงเรา)
   * เพดานนี้แก้ที่ฝั่งเราไม่ได้ ต้องทำให้แต่ละคำขอเล็กลงเท่านั้น
   */
  r.post("/api/beammp/mods/begin", async (req, res) => {
    pass(
      res,
      await callAgent("/mods/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body ?? {}),
      }),
    );
  });

  r.put("/api/beammp/mods/chunk", async (req, res) => {
    const id = String(req.query.id ?? "");
    const offset = String(req.query.offset ?? "");
    pass(
      res,
      await callAgent(
        `/mods/chunk?id=${encodeURIComponent(id)}&offset=${encodeURIComponent(offset)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            // ส่ง content-length ต่อไปด้วย — agent ใช้ปัดตกก้อนที่ทำให้เกินเพดานรวม
            ...(req.get("content-length")
              ? { "content-length": req.get("content-length")! }
              : {}),
          },
          body: Readable.toWeb(req) as ReadableStream,
          duplex: "half",
          timeoutMs: 10 * 60_000,
        },
      ),
    );
  });

  r.post("/api/beammp/mods/finish", async (req, res) => {
    const out = await callAgent("/mods/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
      // ตรวจไฟล์ + สแกนแผนที่ในไฟล์ใหญ่ ๆ ใช้เวลาได้พอสมควร
      timeoutMs: 5 * 60_000,
    });
    if (client && out.status === 200) {
      const name = (out.body as { name?: string })?.name ?? "-";
      await logEvent(client, "info", "system", "beammp_mod_add", "เพิ่มม็อด BeamNG", [
        { name: "ผู้ทำ", value: String(res.locals.username) },
        { name: "ไฟล์", value: name },
      ]);
    }
    pass(res, out);
  });

  r.post("/api/beammp/mods/abort", async (req, res) => {
    pass(
      res,
      await callAgent("/mods/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body ?? {}),
      }),
    );
  });

  r.delete("/api/beammp/mods", async (req, res) => {
    const name = String(req.query.name ?? "");
    const out = await callAgent(`/mods?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (client && out.status === 200) {
      await logEvent(client, "info", "system", "beammp_mod_del", "ลบม็อด BeamNG", [
        { name: "ผู้ทำ", value: String(res.locals.username) },
        { name: "ไฟล์", value: name },
      ]);
    }
    pass(res, out);
  });

  return r;
}
