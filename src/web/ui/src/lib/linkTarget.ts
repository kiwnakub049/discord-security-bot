import { useSyncExternalStore } from "react";

/**
 * เลือกว่าลิงก์ใน log จะเปิดที่ไหน — เบราว์เซอร์ หรือเด้งเข้าแอป Discord เลย
 *
 * ── ทำไมต้องให้เลือก ไม่ตั้งค่าตายตัว ──
 * discord:// เด้งเข้าแอปทันที สะดวกกว่ามากตอนไล่สืบ แต่ถ้าเครื่องไหน "ไม่ได้ติดตั้งแอป"
 * กดแล้วจะไม่เกิดอะไรขึ้นเลย — ไม่มี error ไม่มีหน้าใหม่ ดูเหมือนเว็บพัง
 * ส่วน https ใช้ได้ทุกเครื่องเสมอ แค่ต้องผ่านหน้าเว็บของ Discord ก่อน
 *
 * ค่าเริ่มต้นจึงเป็น https (ปลอดภัยกับทุกเครื่อง) แล้วให้คนที่มีแอปไปเปิดเองในตั้งค่า
 *
 * ใช้ useSyncExternalStore เพื่อให้หน้าตั้งค่ากับรายการ log เห็นค่าเดียวกันทันที
 * โดยไม่ต้องส่ง prop ไล่ลงไปทีละชั้น
 */

const KEY = "link-target";
export type LinkTarget = "browser" | "app";

const listeners = new Set<() => void>();

function read(): LinkTarget {
  return localStorage.getItem(KEY) === "app" ? "app" : "browser";
}

export function setLinkTarget(v: LinkTarget): void {
  if (v === "app") localStorage.setItem(KEY, "app");
  else localStorage.removeItem(KEY);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // แท็บอื่นเปลี่ยนค่า ก็ให้แท็บนี้ตามด้วย
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

export function useLinkTarget(): LinkTarget {
  return useSyncExternalStore(subscribe, read, () => "browser");
}

/** ลิงก์ห้อง — discord:// เด้งเข้าแอป, https เปิดเว็บ */
export function channelUrl(
  guildId: string,
  channelId: string,
  target: LinkTarget,
): string {
  return target === "app"
    ? `discord://-/channels/${guildId}/${channelId}`
    : `https://discord.com/channels/${guildId}/${channelId}`;
}

/** ลิงก์โปรไฟล์คน */
export function userUrl(userId: string, target: LinkTarget): string {
  return target === "app"
    ? `discord://-/users/${userId}`
    : `https://discord.com/users/${userId}`;
}
