import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";

type Tone = "ok" | "error" | "info";
interface Item {
  id: number;
  tone: Tone;
  text: string;
}

const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => {});

/** เรียกจากหน้าไหนก็ได้เพื่อเด้งข้อความสั้น ๆ บอกผลของการกดปุ่ม */
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, tone: Tone = "info") => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, tone, text }]);
    window.setTimeout(
      () => setItems((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/*
        วางไว้เหนือแถบแท็บล่าง (bottom-24) บนมือถือ ไม่งั้นข้อความจะโดนแถบบัง
        pointer-events-none ที่ตัวครอบ = แตะทะลุลงไปกดของข้างล่างได้ตามปกติ
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`glass toast-in pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-2xl px-3.5 py-3 text-sm ${
              t.tone === "ok"
                ? "text-ok"
                : t.tone === "error"
                  ? "text-alert"
                  : "text-text"
            }`}
          >
            <Icon
              name={t.tone === "ok" ? "check" : t.tone === "error" ? "warn" : "info"}
              className="size-4 shrink-0"
            />
            <span className="min-w-0 flex-1">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
