import { createInterface, type Interface } from "node:readline";
import { initDb } from "../store/db.js";
import { setPassword, userExists } from "../auth/users.js";

initDb(); // เปิด/สร้างตาราง ก่อนเรียก store

/**
 * npm run user:passwd <username> — ตั้งรหัสผ่านใหม่ให้บัญชีที่มีอยู่
 *  - รันในเทอร์มินัลจริง: ถามรหัสแบบไม่ echo + ยืนยันอีกครั้ง
 *  - ถ้า pipe ผ่าน stdin: อ่านบรรทัดแรก (บรรทัดสองถ้ามี = ยืนยัน)
 *
 * จงใจไม่รับรหัสทาง argv เพราะมันจะไปโผล่ใน ps และ history ของ shell
 * (ล้อรูปแบบเดียวกับ userAdd.ts เพื่อให้จำวิธีใช้ที่เดียวพอ)
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
  console.error("ใช้:  npm run user:passwd <username>");
  process.exit(1);
}
if (!userExists(username)) {
  console.error(`❌ ไม่มี user "${username}" — ดูรายชื่อได้จากหน้าตั้งค่าใน dashboard`);
  process.exit(1);
}

let password: string;
if (process.stdin.isTTY) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  password = await askHidden(rl, `ตั้งรหัสผ่านใหม่สำหรับ "${username}": `);
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

await setPassword(username, password);
console.log(`✅ เปลี่ยนรหัสผ่านของ "${username}" แล้ว — session เดิมยังใช้ได้ ถ้าอยากตัดให้รีสตาร์ทบอท`);
process.exit(0);
