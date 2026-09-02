/**
 * ตัวห่อ fetch ตัวเดียวของทั้งเว็บ
 *
 * หน้าที่หลักคือจัดการเคสที่ทุกหน้าเจอเหมือนกัน: session หมดอายุ (401)
 * ถ้าปล่อยให้แต่ละหน้าจัดการเอง จะมีบางหน้าลืม แล้วผู้ใช้จะเห็นหน้าว่างเปล่า
 * โดยไม่รู้ว่าต้อง login ใหม่
 */

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("เซิร์ฟเวอร์ไม่ตอบ (หมดเวลา) — ลองใหม่อีกครั้ง", 0);
    }
    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — เช็คเน็ตแล้วลองใหม่", 0);
  } finally {
    window.clearTimeout(timer);
  }

  if (res.status === 401) {
    // session หมดอายุระหว่างเปิดหน้าค้างไว้ — พากลับไป login เลย ไม่ต้องให้เดา
    window.location.href = "/login";
    throw new ApiError("ต้องเข้าสู่ระบบใหม่", 401);
  }

  if (!res.ok) {
    // API ตอบ JSON เสมอเวลาพลาด แต่เผื่อกรณีที่ proxy ขวางแล้วส่ง HTML มาแทน
    let message = `คำขอไม่สำเร็จ (${res.status})`;
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
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
};

/** ต่อ query string โดยข้ามค่าที่ว่าง — ให้ URL สั้นและ cache ตรงกันเวลาเงื่อนไขเหมือนกัน */
export function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
