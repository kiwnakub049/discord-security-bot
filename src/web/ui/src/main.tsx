import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// ฟอนต์ self-host — CSP ตั้ง font-src 'self' ไว้ ลิงก์ Google Fonts จะโดนบล็อก
// แต่ละไฟล์มี unicode-range แยกภาษา เบราว์เซอร์โหลดเฉพาะชุดที่หน้าใช้จริง
import "@fontsource/ibm-plex-sans-thai-looped/400.css";
import "@fontsource/ibm-plex-sans-thai-looped/500.css";
import "@fontsource/ibm-plex-sans-thai-looped/600.css";
import "@fontsource/ibm-plex-sans-thai-looped/700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("ไม่พบ #root ใน index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
