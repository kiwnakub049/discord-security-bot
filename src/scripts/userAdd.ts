import { createInterface, type Interface } from "node:readline";
import { initDb } from "../store/db.js";
import { addUser, userExists } from "../auth/users.js";

initDb(); // เปิด/สร้างตาราง ก่อนเรียก store

/**
 * npm run user:add <username>
 *  - รันในเทอร์มินัลจริง: ถามรหัสผ่านแบบไม่ echo + ยืนยันอีกครั้ง
 *  - ถ้า pipe ผ่าน stdin (เช่นใน script): อ่านรหัสจากบรรทัดแรก (บรรทัดที่สองถ้ามี = ยืนยัน)
 */

type Mutable = { _writeToOutput: (s: string) => void };

function askHidden(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const original = (rl as unknown as Mutable)._writeToOutput;
    (rl as unknown as Mutable)._writeToOutput = () => {}; // ปิด echo ระหว่างพิมพ์รหัส
    rl.question("", (answer) => {
      (rl as unknown as Mutable)._writeToOutput = original;
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

const username = process.argv[2];
if (!username) {
  console.error("ใช้:  npm run user:add <username>");
  process.exit(1);
}
if (userExists(username)) {
  console.error(`❌ มี user "${username}" อยู่แล้ว`);
  process.exit(1);
}

let password: string;
if (process.stdin.isTTY) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  password = await askHidden(rl, `ตั้งรหัสผ่านสำหรับ "${username}": `);
  const confirm = await askHidden(rl, "พิมพ์รหัสผ่านอีกครั้ง: ");
  rl.close();
  if (password !== confirm) {
    console.error("❌ รหัสผ่านไม่ตรงกัน");
    process.exit(1);
  }
} else {
  const lines = (await readAllStdin()).split(/\r?\n/).filter((l) => l.length > 0);
  password = lines[0] ?? "";
  if (lines[1] !== undefined && lines[0] !== lines[1]) {
    console.error("❌ รหัสผ่านไม่ตรงกัน");
    process.exit(1);
  }
}

if (password.length < 8) {
  console.error("❌ รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
  process.exit(1);
}

await addUser(username, password);
console.log(`✅ เพิ่ม user "${username}" เรียบร้อย — login เข้า dashboard ได้เลย`);
process.exit(0);
