/**
 * คำแปลอังกฤษของข้อความที่ server ตอบหน้าเว็บ
 * EXACT: ข้อความไทยตรงตัว → อังกฤษ
 * PATTERNS: [regex, แทนที่] — แทนที่เป็นสตริงใช้ $1 $2 ได้ · เป็นฟังก์ชันได้ (sub = แปลชิ้นย่อยต่อ)
 */
export const EXACT: Record<string, string> = {};

export const PATTERNS: [RegExp, string | ((m: RegExpExecArray, sub: (s: string) => string) => string)][] = [];
