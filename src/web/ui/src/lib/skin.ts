import { useSyncExternalStore } from "react";

/**
 * "หน้าตา" ของเว็บ — แยกจากธีมสว่าง/มืด (สองเรื่องนี้เลือกคู่กันได้อิสระ)
 *
 *   duty = สมุดเวรยาม (ค่าเริ่มต้น)
 *   mac  = หน้าตาแบบ macOS จาก token ของ Apple UI kit
 *
 * ค่า mac มีผลเฉพาะจอกว้างตั้งแต่ 768px ขึ้นไป — CSS ใน index.css ครอบด้วย media query เอง
 * มือถือจึงเป็นสมุดเวรเสมอ ไม่ต้องเช็คขนาดจอใน JS
 *
 * เก็บใน localStorage ของเครื่องนี้ ไม่ได้ใช้ร่วมกับ mod คนอื่น
 */

const KEY = "ui-skin";
export type Skin = "duty" | "mac";

const listeners = new Set<() => void>();

function read(): Skin {
  try {
    return localStorage.getItem(KEY) === "mac" ? "mac" : "duty";
  } catch {
    return "duty";
  }
}

function apply(skin: Skin): void {
  if (skin === "mac") document.documentElement.setAttribute("data-skin", "mac");
  else document.documentElement.removeAttribute("data-skin");
}

/** เรียกครั้งเดียวใน main.tsx ก่อน render — กันหน้าวาบเป็นหน้าตาเดิมหนึ่งเฟรม */
export function applyStoredSkin(): void {
  apply(read());
}

export function setSkin(skin: Skin): void {
  try {
    if (skin === "mac") localStorage.setItem(KEY, "mac");
    else localStorage.removeItem(KEY);
  } catch {
    /* โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ — ใช้ได้แค่จนปิดแท็บ */
  }
  apply(skin);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    apply(read()); // แท็บอื่นเปลี่ยน แท็บนี้ก็เปลี่ยนตาม
    fn();
  };
  listeners.add(fn);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSkin(): Skin {
  return useSyncExternalStore(subscribe, read, () => "duty");
}
