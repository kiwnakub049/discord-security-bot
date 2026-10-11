import { useSyncExternalStore } from "react";

/**
 * การแจ้งเตือนแบบเรียลไทม์ — เปิด/ปิด "เสียง + แจ้งเตือนเดสก์ท็อป" (toast ในแอปเด้งเสมอ)
 *
 * เก็บสถานะเปิด/ปิดใน localStorage แล้วแชร์ผ่าน useSyncExternalStore เหมือน linkTarget
 * เพื่อให้ปุ่มกระดิ่งบนหัวเว็บกับตัวส่งการแจ้งเตือน (StreamNotifier) เห็นค่าเดียวกันทันที
 */

const KEY = "notify-alerts";
const listeners = new Set<() => void>();

function read(): boolean {
  // ค่าเริ่มต้น = เปิด (เก็บ "0" เมื่อผู้ใช้ปิดเอง)
  return localStorage.getItem(KEY) !== "0";
}

export function setNotifyEnabled(v: boolean): void {
  if (v) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, "0");
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

export function useNotifyEnabled(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

/** ขอสิทธิ์แจ้งเตือนเดสก์ท็อป — ต้องเรียกจาก user gesture (เช่นกดปุ่มกระดิ่ง) */
export function requestNotifyPermission(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* บางเบราว์เซอร์/บริบท (http) ไม่มี Notification — ข้ามไปเงียบ ๆ */
  }
}

/** เด้งแจ้งเตือนเดสก์ท็อป (เฉพาะเมื่อได้รับสิทธิ์แล้ว) */
export function notifyDesktop(title: string, body: string): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      // tag เดียวกัน = การแจ้งเตือนใหม่ทับอันเก่า ไม่ถล่มหน้าจอ
      new Notification(title, { body, tag: "sec-bot", icon: "/server-icon" });
    }
  } catch {
    /* ข้าม */
  }
}

/*
 * เสียงเตือนสั้น ๆ ด้วย WebAudio — ไม่ต้องมีไฟล์เสียง
 * AudioContext อาจถูกพักไว้จนกว่าจะมี user gesture ครั้งแรก (นโยบายเบราว์เซอร์)
 * เลย resume ทุกครั้งก่อนเล่น และห่อ try/catch กันพังถ้าเล่นไม่ได้
 */
let audioCtx: AudioContext | null = null;
export function playBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    // สองโน้ตสั้น (โด-ซอล) ให้รู้สึกเป็น "เสียงเตือน" ไม่ใช่บี๊บแบน ๆ
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.setValueAtTime(990, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.start(t);
    osc.stop(t + 0.34);
  } catch {
    /* เล่นเสียงไม่ได้ — ไม่เป็นไร */
  }
}
