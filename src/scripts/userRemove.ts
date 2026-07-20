import { initDb } from "../store/db.js";
import { listUsers, removeUser, userExists } from "../auth/users.js";

initDb(); // เปิด/สร้างตาราง ก่อนเรียก store

/**
 * npm run user:remove <username>
 * ตัดสิทธิ์ทันที — session ที่ user คนนี้ค้างอยู่จะใช้ไม่ได้อีกต่อไป
 */

const username = process.argv[2];
if (!username) {
  console.error("ใช้:  npm run user:remove <username>");
  process.exit(1);
}
if (!userExists(username)) {
  const users = listUsers();
  console.error(
    `❌ ไม่พบ user "${username}"\n   รายชื่อที่มี: ${users.length ? users.join(", ") : "(ยังไม่มีใคร)"}`,
  );
  process.exit(1);
}

removeUser(username);
console.log(
  `✅ ลบ user "${username}" แล้ว — session ที่ค้างอยู่ของบัญชีนี้จะใช้ไม่ได้ทันที`,
);
process.exit(0);
