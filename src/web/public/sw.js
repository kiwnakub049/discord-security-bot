/*
 * Service worker — รับ Web Push แล้วโชว์แจ้งเตือน แม้ปิดหน้าเว็บอยู่
 * (เสิร์ฟจาก /sw.js ก่อน login ได้: ไม่มีข้อมูลอะไรในไฟล์นี้ และต้องอยู่ที่ root ถึงคุมได้ทั้งเว็บ)
 *
 * payload จาก server: { title, body, tag, url }
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d;
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // กำลังเปิดแชททีมอยู่บนหน้าจอ = เห็นข้อความอยู่แล้ว ไม่ต้องเด้งซ้ำ
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const watching = wins.some(
        (c) => c.focused && c.visibilityState === "visible" && new URL(c.url).pathname === "/team",
      );
      if (watching && String(d.tag || "").startsWith("team:")) return;
      await self.registration.showNotification(d.title || "Undawn Dashboard", {
        body: d.body || "",
        tag: d.tag || "undawn",
        renotify: true,
        icon: "/server-icon",
        data: { url: d.url || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((c) => new URL(c.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        // หน้าเว็บสลับหน้าเองผ่าน router (ไม่ต้องโหลดใหม่ทั้งหน้า)
        win.postMessage({ type: "navigate", url: new URL(url).pathname });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
