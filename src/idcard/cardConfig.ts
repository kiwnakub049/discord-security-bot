import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ตั้งค่า layout บัตรประจำตัว — เทมเพลต ID_Card-final.png (1011x639)
 * ฟิลด์: NO. / Member ID / Name / Join server on / Status
 * พิกัดเป็น (x, y) มุมซ้ายบนของข้อความ (ปรับได้ตามต้องการ)
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const assets = join(__dirname, "assets");

export const cardConfig = {
  templatePath: join(assets, "card_template.png"),
  fontPath: join(assets, "fonts", "Sarabun-Regular.ttf"),
  fontBoldPath: join(assets, "fonts", "Sarabun-Bold.ttf"),
  fontFamily: "Sarabun",
  fontBoldFamily: "SarabunBold",

  // Avatar (วางในกรอบรูป polaroid ฝั่งซ้าย) — วาดแบบ cover เติมเต็มกรอบ
  avatarPos: { x: 126, y: 165 },
  avatarSize: { w: 286, h: 302 },
  avatarCircle: false,
  avatarRotateDeg: -6.69, // หมุนตามกรอบ polaroid ที่เอียง (ลบ = ทวนเข็ม, บวก = ตามเข็ม)

  // กรอบถมสีพื้นหลัง (ใหญ่กว่า avatar นิดหน่อย) เพื่อกลบ landscape ในช่องว่างรอบ avatar
  frameCoverPos: { x: 114, y: 153 },
  frameCoverSize: { w: 310, h: 326 },

  // ตำแหน่งค่าข้อความ (หลัง label / บนเส้นประ)
  noPos: { x: 600, y: 130 },
  memberIdPos: { x: 650, y: 185 },
  namePos: { x: 650, y: 242 },
  joinPos: { x: 700, y: 297 },
  statusPos: { x: 650, y: 355 },

  fontSize: 26,
  textColor: "rgb(60, 50, 45)",
  idZeroFill: 4,
  noPrefix: "VL-", // NO. แสดงเป็น VL-0001
} as const;
