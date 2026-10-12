/**
 * คำแปลอังกฤษ — แยกไฟล์ตามส่วนของหน้าเว็บ แล้วรวมตรงนี้
 * key = ข้อความไทยที่ส่งเข้า t() ตรงตัวอักษร (รวมช่องว่าง/เครื่องหมาย และ {ตัวแปร})
 * common = lib ทั่วไป · a = ตั้งค่า/ผู้ช่วย/แชททีม · b = หน้าแรก/สมาชิก/โครงหน้า/BeamNG · c = Logs
 */
import { common } from "./common";
import { a } from "./a";
import { b } from "./b";
import { c } from "./c";

export const EN: Record<string, string> = {
  ...common,
  ...a,
  ...b,
  ...c,
};
