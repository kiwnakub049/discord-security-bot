/**
 * ประกอบไฟล์ CSV สำหรับดาวน์โหลดบันทึกเหตุการณ์
 *
 * แยกเป็นโมดูลของตัวเองที่ไม่แตะ DB/express เลย เพื่อให้เทสเรียกใช้ตรง ๆ ได้
 * โดยไม่ต้องเปิดฐานข้อมูลขึ้นมาก่อน
 */

/**
 * เตรียมค่าหนึ่งช่องให้ปลอดภัยและถูกไวยากรณ์ CSV
 *
 * เติม ' นำหน้าเมื่อขึ้นต้นด้วย = + - @ tab หรือ CR — กัน formula injection:
 * Excel/Sheets จะรันเซลล์ที่ขึ้นต้นด้วยอักขระพวกนี้เป็นสูตร ซึ่งแปลว่า
 * ข้อความที่ผู้ใช้ Discord พิมพ์เข้ามาสามารถกลายเป็นคำสั่งในเครื่องคนที่เปิดไฟล์ได้
 */
export function csvCell(value: unknown): string {
  let v = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** ต่อหัวตารางกับแถวข้อมูลเป็นข้อความ CSV ทั้งไฟล์ */
export function toCsv(header: string[], rows: unknown[][]): string {
  return [
    header.map(csvCell).join(","),
    ...rows.map((r) => r.map(csvCell).join(",")),
  ].join("\n");
}

/**
 * BOM ของ UTF-8 — ต้องมี ไม่งั้น Excel บน Windows อ่านภาษาไทยเป็นตัวยึกยือ
 * (มันเดารหัสอักขระจากไบต์แรกของไฟล์ ไม่ได้ดู Content-Type ที่ส่งไป)
 */
export const BOM = "﻿";
