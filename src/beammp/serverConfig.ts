import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { FIELDS, validateField, type FieldValue } from "./fields.js";

/**
 * อ่าน/แก้ ServerConfig.toml ของ BeamMP
 *
 * ── ทำไมเขียนแบบแก้ทีละบรรทัด ไม่ parse แล้ว serialize ใหม่ทั้งไฟล์ ──
 * ไฟล์นี้ BeamMP เป็นคนสร้างและมีคอมเมนต์อธิบายทุกค่า ถ้าเรา generate ใหม่
 * คอมเมนต์จะหาย และคีย์ที่เวอร์ชันใหม่เพิ่มมาแต่เรายังไม่รู้จักจะถูกลบทิ้ง
 * ทำให้เซิร์ฟกลับไปใช้ค่า default โดยไม่มีใครรู้ตัว
 * แก้เฉพาะบรรทัดที่ตรงคีย์จึงปลอดภัยกว่า และรองรับเวอร์ชันใหม่ได้เอง
 */

/** คีย์ที่ห้ามส่งออกไปฝั่งเว็บเด็ดขาด */
const SECRET_KEYS = new Set(["AuthKey"]);

export interface ParsedConfig {
  /** section -> key -> ค่าที่แปลงชนิดแล้ว */
  values: Map<string, Map<string, FieldValue>>;
}

function decodeValue(raw: string): FieldValue {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (m) return m[1]!.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
  return s; // ค่าที่ไม่รู้จักรูปแบบ — คืนดิบไป ไม่เดา
}

function encodeValue(v: FieldValue): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** จับบรรทัดหัวข้อ [Section] */
const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
/** จับบรรทัด Key = Value (ไม่เอาบรรทัดคอมเมนต์ที่ขึ้นต้นด้วย #) */
const KV_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;

export function parseConfig(text: string): ParsedConfig {
  const values = new Map<string, Map<string, FieldValue>>();
  let section = "";
  for (const line of text.split("\n")) {
    const sm = SECTION_RE.exec(line);
    if (sm) {
      section = sm[1]!;
      if (!values.has(section)) values.set(section, new Map());
      continue;
    }
    if (/^\s*#/.test(line)) continue;
    const km = KV_RE.exec(line);
    if (!km) continue;
    if (!values.has(section)) values.set(section, new Map());
    values.get(section)!.set(km[2]!, decodeValue(km[4]!));
  }
  return { values };
}

/**
 * แทนค่าคีย์ที่ระบุ โดยคงคอมเมนต์และคีย์อื่นไว้ทั้งหมด
 * คีย์ที่ไม่มีอยู่ในไฟล์จะถูกข้าม (ไม่แทรกใหม่) — กันพิมพ์ผิดแล้วได้คีย์ขยะ
 */
export function patchConfig(
  text: string,
  patch: Map<string, { section: string; value: FieldValue }>,
): { text: string; applied: string[]; missing: string[] } {
  const applied: string[] = [];
  let section = "";
  const lines = text.split("\n").map((line) => {
    const sm = SECTION_RE.exec(line);
    if (sm) {
      section = sm[1]!;
      return line;
    }
    if (/^\s*#/.test(line)) return line;
    const km = KV_RE.exec(line);
    if (!km) return line;
    const key = km[2]!;
    const want = patch.get(key);
    if (!want || want.section !== section) return line;
    applied.push(key);
    return `${km[1]}${key}${km[3]}${encodeValue(want.value)}`;
  });
  const missing = [...patch.keys()].filter((k) => !applied.includes(k));
  return { text: lines.join("\n"), applied, missing };
}

/** ค่าที่ปลอดภัยพอจะส่งไปแสดงบนเว็บ — ตัด AuthKey และคีย์นอกบัญชีขาวออก */
export function publicValues(text: string): Record<string, FieldValue> {
  const { values } = parseConfig(text);
  const out: Record<string, FieldValue> = {};
  for (const [key, spec] of Object.entries(FIELDS)) {
    if (SECRET_KEYS.has(key)) continue;
    const v = values.get(spec.section)?.get(key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** ตั้ง AuthKey แล้วหรือยัง — บอกได้โดยไม่ต้องเปิดเผยตัวคีย์ */
export function hasAuthKey(text: string): boolean {
  const v = parseConfig(text).values.get("General")?.get("AuthKey");
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * เขียนไฟล์แบบ atomic — เขียนไฟล์ชั่วคราวแล้วค่อย rename ทับ
 * ถ้าไฟดับกลางคัน ไฟล์เดิมยังอยู่ครบ ไม่กลายเป็นไฟล์ครึ่ง ๆ ที่เซิร์ฟอ่านไม่ออก
 */
export function writeConfigFile(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

export function readConfigFile(path: string): string {
  if (!existsSync(path)) throw new Error(`ไม่พบไฟล์ตั้งค่า: ${path}`);
  return readFileSync(path, "utf8");
}

/**
 * ตรวจ + แก้ค่าหลายตัวพร้อมกัน — จุดเดียวที่ฝั่งเว็บใช้เขียนไฟล์ได้
 * ถ้ามีค่าไหนไม่ผ่าน จะไม่เขียนอะไรเลย (ทั้งหมดหรือไม่ทำเลย)
 */
export function applyPatch(
  path: string,
  input: Record<string, unknown>,
): { ok: true; applied: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const patch = new Map<string, { section: string; value: FieldValue }>();

  for (const [key, raw] of Object.entries(input)) {
    const r = validateField(key, raw);
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    patch.set(key, { section: FIELDS[key]!.section, value: r.value });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (patch.size === 0) return { ok: true, applied: [] };

  const text = readConfigFile(path);
  const { text: next, applied, missing } = patchConfig(text, patch);
  if (missing.length > 0)
    return { ok: false, errors: [`ไม่พบค่าเหล่านี้ในไฟล์: ${missing.join(", ")}`] };

  writeConfigFile(path, next);
  return { ok: true, applied };
}
