/**
 * รายการค่าที่ "แก้จากหน้าเว็บได้" ของ ServerConfig.toml
 *
 * ── ทำไมต้องมีบัญชีขาว ไม่ให้ส่ง TOML ดิบมาเขียนทับ ──
 * ไฟล์นี้มี AuthKey อยู่ด้วย ถ้าปล่อยให้ฝั่งเว็บส่งเนื้อไฟล์มาทั้งก้อน
 * ใครที่ยิง request ได้ก็เขียนคีย์ลับทับ หรือแอบอ่านกลับออกไปได้
 * ทางนี้จึงรับเฉพาะ "ชื่อค่า + ค่าใหม่" ที่อยู่ในรายการนี้เท่านั้น
 * ค่านอกรายการ (รวม AuthKey) แก้ไม่ได้และไม่ถูกส่งออกไปฝั่งเว็บเลย
 */

export type FieldSpec =
  | { section: string; type: "string"; label: string; max: number; multiline?: boolean }
  | { section: string; type: "int"; label: string; min: number; max: number }
  | { section: string; type: "bool"; label: string }
  | { section: string; type: "map"; label: string };

/** แผนที่ที่มากับตัวเกม — ใส่เป็นตัวเลือกให้กด ไม่ต้องพิมพ์ path เอง */
export const MAPS: { value: string; label: string }[] = [
  { value: "/levels/gridmap_v2/info.json", label: "Gridmap v2" },
  { value: "/levels/west_coast_usa/info.json", label: "West Coast USA" },
  { value: "/levels/east_coast_usa/info.json", label: "East Coast USA" },
  { value: "/levels/italy/info.json", label: "Italy" },
  { value: "/levels/utah/info.json", label: "Utah" },
  { value: "/levels/johnson_valley/info.json", label: "Johnson Valley" },
  { value: "/levels/jungle_rock_island/info.json", label: "Jungle Rock Island" },
  { value: "/levels/small_island/info.json", label: "Small Island" },
  { value: "/levels/hirochi_raceway/info.json", label: "Hirochi Raceway" },
  { value: "/levels/automation_test_track/info.json", label: "Automation Test Track" },
  { value: "/levels/industrial/info.json", label: "Industrial" },
  { value: "/levels/derby/info.json", label: "Derby Arenas" },
  { value: "/levels/driver_training/info.json", label: "Driver Training" },
  { value: "/levels/smallgrid/info.json", label: "Grid, Small, Pure" },
  { value: "/levels/car_jump_arena/info.json", label: "Car Jump Arena" },
];

export const FIELDS: Record<string, FieldSpec> = {
  Name: { section: "General", type: "string", label: "ชื่อเซิร์ฟเวอร์", max: 100 },
  Description: {
    section: "General",
    type: "string",
    label: "คำอธิบาย",
    max: 500,
    multiline: true,
  },
  Map: { section: "General", type: "map", label: "แผนที่" },
  MaxPlayers: { section: "General", type: "int", label: "ผู้เล่นสูงสุด", min: 1, max: 64 },
  MaxCars: { section: "General", type: "int", label: "รถต่อคน", min: 1, max: 20 },
  Tags: { section: "General", type: "string", label: "แท็ก", max: 100 },
  Private: { section: "General", type: "bool", label: "ไม่ประกาศในรายการสาธารณะ" },
  AllowGuests: { section: "General", type: "bool", label: "ให้ guest เข้าได้" },
  LogChat: { section: "General", type: "bool", label: "บันทึกแชทลง log" },
  Debug: { section: "General", type: "bool", label: "โหมด debug" },
};

export type FieldValue = string | number | boolean;

/**
 * ชื่อโฟลเดอร์แผนที่ที่ยอมรับ
 *
 * อยู่ที่เดียวเพราะใช้สองที่: ตอนตรวจค่าที่ผู้ใช้เลือก และตอนสแกนหาแผนที่ในไฟล์ม็อด
 * ถ้าสองที่ใช้กฎคนละชุด จะเกิดอาการ "สแกนไม่เจอแต่พิมพ์เองได้" หรือกลับกัน
 * (เจอจริงตอนทดสอบ: ตัวสแกนไม่รับจุด เลยมองข้ามแผนที่ชื่อ drift.playground.v2)
 */
export const LEVEL_FOLDER_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export function isValidLevelFolder(folder: string): boolean {
  if (!LEVEL_FOLDER_RE.test(folder)) return false;
  // ".." คือทางออกนอกโฟลเดอร์เกม ส่วนจุดหน้า/ท้ายคือไฟล์ซ่อนหรือชื่อกำกวม
  return !folder.includes("..") && !folder.startsWith(".") && !folder.endsWith(".");
}

/** แปลง path แผนที่เป็นชื่อสั้นไว้แสดงผล — "/levels/italy/info.json" -> "italy" */
export function levelName(path: string): string {
  return /\/levels\/([^/]+)\//.exec(path)?.[1] ?? path;
}

/**
 * ตรวจค่าที่ส่งมาจากเว็บก่อนเขียนลงไฟล์
 * @returns ค่าที่ผ่านการแปลงชนิดแล้ว หรือข้อความบอกว่าผิดตรงไหน
 */
export function validateField(
  key: string,
  raw: unknown,
): { ok: true; value: FieldValue } | { ok: false; error: string } {
  const spec = FIELDS[key];
  if (!spec) return { ok: false, error: `แก้ค่า "${key}" จากหน้าเว็บไม่ได้` };

  switch (spec.type) {
    case "bool":
      if (typeof raw !== "boolean") return { ok: false, error: `${spec.label}: ต้องเป็น true/false` };
      return { ok: true, value: raw };

    case "int": {
      if (typeof raw !== "number" || !Number.isInteger(raw))
        return { ok: false, error: `${spec.label}: ต้องเป็นจำนวนเต็ม` };
      if (raw < spec.min || raw > spec.max)
        return { ok: false, error: `${spec.label}: ต้องอยู่ระหว่าง ${spec.min}–${spec.max}` };
      return { ok: true, value: raw };
    }

    case "map": {
      if (typeof raw !== "string") return { ok: false, error: "แผนที่: ต้องเป็นข้อความ" };
      /*
       * แผนที่จากม็อดใช้ได้ แต่ต้องเป็นรูปแบบ path ของเกมเท่านั้น
       * ยอมให้มีจุดในชื่อได้ (ม็อดหลายตัวตั้งชื่อแบบ my.map.v2) แต่ห้าม ".."
       * ไม่งั้นค่านี้กลายเป็นทางออกนอกโฟลเดอร์เกมได้
       */
      const m = /^\/levels\/([^/]+)\/info\.json$/.exec(raw);
      if (!m)
        return { ok: false, error: "แผนที่: ต้องเป็นรูปแบบ /levels/<ชื่อ>/info.json" };
      if (!isValidLevelFolder(m[1]!))
        return { ok: false, error: "แผนที่: ชื่อโฟลเดอร์ใช้ไม่ได้" };
      return { ok: true, value: raw };
    }

    case "string": {
      if (typeof raw !== "string") return { ok: false, error: `${spec.label}: ต้องเป็นข้อความ` };
      if (raw.length > spec.max)
        return { ok: false, error: `${spec.label}: ยาวเกิน ${spec.max} ตัวอักษร` };
      /*
       * ขึ้นบรรทัดใหม่ทำให้ค่าหนึ่งค่ากลายเป็นหลายบรรทัดในไฟล์ TOML
       * ซึ่งเท่ากับแทรกคีย์ใหม่เข้าไปได้ — ตัดทิ้งตั้งแต่ต้นทาง
       * (ตัวเขียนไฟล์ escape ให้อีกชั้นอยู่แล้ว นี่คือด่านแรก)
       */
      if (/[\r\n]/.test(raw)) return { ok: false, error: `${spec.label}: ห้ามขึ้นบรรทัดใหม่` };
      return { ok: true, value: raw };
    }
  }
}
