import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "ui-theme";

function stored(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/**
 * สลับธีมสว่าง/มืด
 *
 * "system" = ไม่ตั้ง data-theme เลย ปล่อยให้ @media prefers-color-scheme ใน CSS ทำงาน
 * ข้อดีคือหน้าไม่กระพริบตอนโหลด เพราะสีถูกตัดสินตั้งแต่ก่อน JS จะรัน
 * (ถ้าใช้ JS ตั้งค่าทุกกรณี จะเห็นธีมสว่างวาบหนึ่งเฟรมก่อนสลับเป็นมืด)
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);

    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  }, [theme]);

  return [theme, useCallback((t: Theme) => setTheme(t), [])];
}
