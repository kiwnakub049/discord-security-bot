import { useCallback, useEffect, useState } from "react";

export const ROUTES = ["/", "/logs", "/members", "/beamng", "/settings"] as const;
export type Route = (typeof ROUTES)[number];

function current(): Route {
  const p = window.location.pathname;
  return (ROUTES as readonly string[]).includes(p) ? (p as Route) : "/";
}

/**
 * เราเตอร์ขนาดจิ๋ว — 4 หน้าคงที่ ไม่มีพารามิเตอร์ใน path
 *
 * ไม่ลง react-router เพราะจะแลกขนาดบันเดิลกับความสามารถที่ไม่ได้ใช้เลย
 * (nested route, loader, param matching) ส่วนที่จำเป็นจริง ๆ คือ
 * ปุ่มย้อนกลับของเบราว์เซอร์ต้องทำงาน ซึ่ง popstate จัดการให้ครบแล้ว
 */
export function useRoute(): [Route, (to: Route) => void] {
  const [route, setRoute] = useState<Route>(current);

  useEffect(() => {
    const onPop = () => setRoute(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((to: Route) => {
    if (to !== window.location.pathname) window.history.pushState(null, "", to);
    setRoute(to);
    window.scrollTo({ top: 0 });
  }, []);

  return [route, go];
}
