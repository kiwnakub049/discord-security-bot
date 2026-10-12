/**
 * แจ้งเตือนมือถือ (Web Push) ฝั่งหน้าเว็บ — สมัคร/เลิก/เลือกเรื่อง แยกต่อเครื่อง
 *
 * service worker (/sw.js) เป็นตัวรับ push แล้วโชว์แจ้งเตือน แม้ปิดเว็บอยู่
 * iPhone: Safari รับ push ได้เฉพาะเว็บที่ "เพิ่มลงหน้าโฮม" แล้วเปิดจากไอคอนนั้น (iOS 16.4+)
 */
import { api } from "./api";

export type PushTopic = "queue" | "mention" | "general";
export const ALL_TOPICS: PushTopic[] = ["queue", "mention", "general"];
/** ค่าเริ่มตอนเปิดรับครั้งแรก — ห้องรวมเด้งบ่อย ให้คนเลือกเปิดเอง */
export const DEFAULT_TOPICS: PushTopic[] = ["queue", "mention"];

export type PushSupport =
  | "ok"
  /** iPhone/iPad ที่ยังไม่ได้เพิ่มลงหน้าโฮม */
  | "ios-install"
  | "unsupported";

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !standalone()) return "ios-install";
  return has && window.isSecureContext ? "ok" : "unsupported";
}

let reg: Promise<ServiceWorkerRegistration | null> | null = null;

/** ลงทะเบียน service worker ตอนเปิดเว็บ (เรียกซ้ำได้) */
export function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return Promise.resolve(null);
  reg ??= navigator.serviceWorker.register("/sw.js").catch(() => null);
  return reg;
}

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const r = await registerSW();
  return (await r?.pushManager.getSubscription()) ?? null;
}

/** สถานะเครื่องนี้ฝั่ง server (สมัครไว้ไหม รับเรื่องอะไร) */
export async function pushStatus(): Promise<{ subscribed: boolean; topics: PushTopic[] }> {
  const sub = await currentSubscription();
  if (!sub) return { subscribed: false, topics: [] };
  return api.post("/api/push/status", { endpoint: sub.endpoint });
}

/** เปิดรับ / เปลี่ยนเรื่องที่รับ — ต้องเรียกจากการกดปุ่ม (เบราว์เซอร์บังคับตอนขอสิทธิ์) */
export async function enablePush(topics: PushTopic[]): Promise<void> {
  const r = await registerSW();
  if (!r) throw new Error("no-sw");
  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") throw new Error("denied");
  }
  let sub = await r.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api.get<{ publicKey: string }>("/api/push/key");
    sub = await r.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey) as BufferSource,
    });
  }
  await api.post("/api/push/subscribe", { subscription: sub.toJSON(), topics });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => null);
  await sub.unsubscribe().catch(() => null);
}

export async function testPush(): Promise<string> {
  const sub = await currentSubscription();
  if (!sub) throw new Error("no-sub");
  return (await api.post<{ message: string }>("/api/push/test", { endpoint: sub.endpoint })).message;
}
