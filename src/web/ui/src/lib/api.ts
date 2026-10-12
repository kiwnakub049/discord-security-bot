/**
 * ตัวห่อ fetch ตัวเดียวของทั้งเว็บ
 *
 * หน้าที่หลักคือจัดการเคสที่ทุกหน้าเจอเหมือนกัน: session หมดอายุ (401)
 * ถ้าปล่อยให้แต่ละหน้าจัดการเอง จะมีบางหน้าลืม แล้วผู้ใช้จะเห็นหน้าว่างเปล่า
 * โดยไม่รู้ว่าต้อง login ใหม่
 */

import { lang, t } from "./i18n";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// กันหน้า "หมุนค้างถาวร": ถ้า request ไม่ตอบใน 20 วิ ให้ยกเลิกแล้วโยน error
// เพื่อให้หน้าเว็บโชว์ปุ่มลองใหม่/ข้อความ แทนที่จะหมุน spinner ไปเรื่อย ๆ
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        // server แปลข้อความตอบกลับ (message/error) ตามภาษานี้
        "X-Lang": lang,
        ...init?.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(t("เซิร์ฟเวอร์ไม่ตอบ (หมดเวลา) — ลองใหม่อีกครั้ง"), 0);
    }
    throw new ApiError(t("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — เช็คเน็ตแล้วลองใหม่"), 0);
  } finally {
    window.clearTimeout(timer);
  }

  if (res.status === 401) {
    // session หมดอายุระหว่างเปิดหน้าค้างไว้ — พากลับไป login เลย ไม่ต้องให้เดา
    window.location.href = "/login";
    throw new ApiError(t("ต้องเข้าสู่ระบบใหม่"), 401);
  }

  if (!res.ok) {
    // API ตอบ JSON เสมอเวลาพลาด แต่เผื่อกรณีที่ proxy ขวางแล้วส่ง HTML มาแทน
    let message = t("คำขอไม่สำเร็จ ({status})", { status: res.status });
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      /* ไม่ใช่ JSON — ใช้ข้อความตั้งต้น */
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  /** timeoutMs: งานที่รู้ว่านาน (เช่นแชทกับ Claude ที่วนค้นข้อมูลหลายรอบ) ขยายเวลารอได้ */
  post: <T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> =>
    request<T>(
      path,
      {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      timeoutMs,
    ),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "PUT",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  del: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};

/**
 * อัปโหลดไฟล์ม็อด — ซอยเป็นก้อนแล้วส่งทีละก้อน
 *
 * ── ทำไมไม่ส่งรวดเดียว ──
 * เว็บวิ่งผ่าน Cloudflare Tunnel ซึ่งแผนฟรีตัด body ที่ 100 MiB ต่อคำขอ
 * (วัดแล้ว: 104,857,600 bytes ขึ้นไปได้ 413 จากขอบ Cloudflare ตั้งแต่ยังไม่ถึงเซิร์ฟเวอร์เรา)
 * ต่อให้ฝั่งเราสตรีมได้ดีแค่ไหนก็ไม่ช่วย เพราะก้อนไม่เคยมาถึง
 *
 * ใช้ XMLHttpRequest ไม่ใช่ fetch เพราะ fetch บอกความคืบหน้าขา "อัป" ไม่ได้
 * ไฟล์ใหญ่บน Wi-Fi ใช้เวลาเป็นนาที ถ้าไม่มีตัวเลขบอกผู้ใช้จะคิดว่าค้าง
 */
function putBlob(path: string, blob: Blob, onProgress?: (loaded: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", path);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => {
      if (xhr.status === 401) {
        window.location.href = "/login";
        reject(new ApiError(t("ต้องเข้าสู่ระบบใหม่"), 401));
        return;
      }
      let body: { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        /* ไม่ใช่ JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body.error ?? `ส่งไม่สำเร็จ (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("เชื่อมต่อไม่ได้ระหว่างอัปโหลด", 0));
    xhr.send(blob);
  });
}

export async function uploadMod(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ name?: string; levels?: string[] }> {
  const begin = await api.post<{ ok: boolean; id: string; chunkBytes: number; error?: string }>(
    "/api/beammp/mods/begin",
    { name: file.name },
  );
  if (!begin.ok) throw new ApiError(begin.error ?? "เริ่มอัปโหลดไม่ได้", 400);

  const size = begin.chunkBytes;
  try {
    for (let offset = 0; offset < file.size; offset += size) {
      const chunk = file.slice(offset, Math.min(offset + size, file.size));
      const base = offset;
      await putBlob(
        `/api/beammp/mods/chunk?id=${begin.id}&offset=${offset}`,
        chunk,
        // ความคืบหน้าของทั้งไฟล์ = ก้อนที่ส่งจบแล้ว + ที่กำลังส่งอยู่ในก้อนนี้
        (loaded) => onProgress?.(Math.min(1, (base + loaded) / file.size)),
      );
    }
    return await api.post<{ name?: string; levels?: string[] }>(
      "/api/beammp/mods/finish",
      { id: begin.id },
    );
  } catch (err) {
    // เก็บกวาดไฟล์ครึ่ง ๆ ฝั่งเซิร์ฟเวอร์ ไม่ปล่อยให้ค้างกินดิสก์
    void api.post("/api/beammp/mods/abort", { id: begin.id }).catch(() => {});
    throw err;
  }
}

/**
 * อัปไฟล์แนบของแชททีม — ส่งรวดเดียว (ไฟล์ไม่เกิน 100 MB ต่ำกว่าเพดานของ Cloudflare)
 * ได้ id กลับไปแนบตอนส่งข้อความ
 */
export async function uploadTeamFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ id: string; size: number }> {
  const q = new URLSearchParams({ name: file.name, type: file.type || "application/octet-stream" });
  const r = (await putBlob(`/api/team/files?${q}`, file, (loaded) =>
    onProgress?.(file.size ? Math.min(1, loaded / file.size) : 1),
  )) as { ok?: boolean; id?: string; size?: number; error?: string };
  if (!r.ok || !r.id) throw new ApiError(r.error ?? "อัปโหลดไม่สำเร็จ", 400);
  return { id: r.id, size: r.size ?? file.size };
}

/** ต่อ query string โดยข้ามค่าที่ว่าง — ให้ URL สั้นและ cache ตรงกันเวลาเงื่อนไขเหมือนกัน */
export function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
