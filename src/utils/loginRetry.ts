/**
 * ลองล็อกอินซ้ำแบบถอยหลังเพิ่มทีละเท่าตัว (exponential backoff)
 *
 * ทำไมต้องมี: ตอนเครื่องบูต systemd ปล่อย service ทันทีที่ network-online.target ถึง
 * แต่บน Pi ตัวนี้จังหวะนั้น DNS ยังตอบไม่ได้ (getaddrinfo EAI_AGAIN) การล็อกอินเลยพัง
 * ถ้าปล่อยให้ error หลุดไปถึง handler uncaughtException มันจะถูกกลืน แล้ว process
 * อยู่ต่อได้เพราะเว็บ dashboard ยังคา event loop ไว้ — ผลคือ systemd รายงานว่า active
 * ทั้งที่บอทไม่ได้อยู่ในเซิร์ฟเวอร์เลย ซึ่งเป็นอาการที่มองไม่เห็นจนกว่าจะไปเปิด Discord ดู
 *
 * กันสองชั้น: ในนี้ลองเองไม่กี่ครั้ง (รอดจากกรณี DNS ช้าไม่กี่วินาที โดยไม่ต้องกวน systemd)
 * ถ้ายังไม่ได้จริง ๆ ให้โยนต่อเพื่อให้ผู้เรียกจบ process ด้วย exit code ไม่ใช่ศูนย์
 * แล้ว Restart=on-failure จะพามาลองใหม่ทั้งรอบ
 */

export interface LoginRetryOptions {
  attempts?: number;
  /** หน่วงก่อนลองครั้งถัดไป (มิลลิวินาที) — คูณสองไปเรื่อย ๆ */
  baseDelayMs?: number;
  /** แทนที่ได้ในเทสต์ เพื่อไม่ต้องรอจริง */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  /** คืน false = พังถาวร ลองใหม่ไปก็เท่านั้น ให้โยนออกทันที */
  shouldRetry?: (err: unknown) => boolean;
}

/**
 * โทเคนผิด/ถูก reset = ลองอีกกี่ครั้งก็ได้ผลเดิม ต่างจากเน็ตล่มที่เดี๋ยวก็กลับมา
 * แยกสองกรณีนี้ออกจากกัน เพื่อไม่ให้ systemd วนรีสตาร์ทไม่จบกับปัญหาที่ต้องแก้ด้วยมือ
 */
export function isPermanentLoginError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; message?: unknown };
  // TokenInvalid = โทเคนรูปแบบถูกแต่ใช้ไม่ได้แล้ว (โดน Reset Token) — Discord ตอบมาเอง
  // UND_ERR_INVALID_ARG = โทเคนผิดรูปแบบจนใส่ลง header ไม่ได้ (เช่นพิมพ์ตกใน .env)
  // undici ตีกลับตั้งแต่ยังไม่ได้ยิงออกไป ทั้งคู่แก้ได้ด้วยมือเท่านั้น
  if (
    e?.code === "TokenInvalid" ||
    e?.code === "UND_ERR_INVALID_ARG" ||
    e?.status === 401
  ) {
    return true;
  }
  return /invalid token|invalid authorization header|unauthorized/i.test(
    String(e?.message ?? ""),
  );
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function loginWithRetry<T>(
  login: () => Promise<T>,
  options: LoginRetryOptions = {},
): Promise<T> {
  const {
    attempts = 5,
    baseDelayMs = 2000,
    sleep = wait,
    onRetry = () => {},
    shouldRetry = () => true,
  } = options;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await login();
    } catch (err) {
      lastErr = err;
      // ครั้งสุดท้ายไม่ต้องหน่วงแล้ว โยนออกไปเลย ให้ผู้เรียกตัดสินใจ
      if (i === attempts - 1 || !shouldRetry(err)) break;
      const delayMs = baseDelayMs * 2 ** i;
      onRetry(i + 1, delayMs, err);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
