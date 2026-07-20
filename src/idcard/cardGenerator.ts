import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { cardConfig as C } from "./cardConfig.js";
import type { MemberCard } from "./members.js";

/**
 * สร้างรูปบัตรประจำตัวบนเทมเพลต ID_Card-final.png
 * คืนเป็น PNG Buffer พร้อมแนบส่งใน Discord
 */

let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(C.fontPath, C.fontFamily);
  GlobalFonts.registerFromPath(C.fontBoldPath, C.fontBoldFamily);
  fontsReady = true;
}

async function fetchImage(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`โหลด avatar ไม่ได้: ${res.status}`);
  return loadImage(Buffer.from(await res.arrayBuffer()));
}

export async function generateIdCard(
  username: string,
  userId: string,
  avatarUrl: string,
  card: MemberCard,
  level = 1,
): Promise<Buffer> {
  ensureFonts();

  const template = await loadImage(C.templatePath);
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(template, 0, 0);

  const avatar = await fetchImage(avatarUrl);
  const bx = C.avatarPos.x, by = C.avatarPos.y, bw = C.avatarSize.w, bh = C.avatarSize.h;
  const cx = bx + bw / 2, cy = by + bh / 2;
  // cover-fit: ย่อ/ขยายให้เติมเต็มกรอบโดยคงสัดส่วน แล้วตัดส่วนเกินด้วย clip
  const scale = Math.max(bw / avatar.width, bh / avatar.height);
  const dw = avatar.width * scale, dh = avatar.height * scale;
  const dx = bx + (bw - dw) / 2, dy = by + (bh - dh) / 2;
  const rad = (C.avatarRotateDeg * Math.PI) / 180;

  // สุ่มสีพื้นหลังจากในกรอบ (ไว้ถมช่องว่างรอบ avatar ให้กลมกลืน)
  const sp = ctx.getImageData(bx + 6, by + 6, 1, 1).data;
  const bgColor = `rgb(${sp[0]}, ${sp[1]}, ${sp[2]})`;

  ctx.save();
  // หมุนรอบจุดกลางกรอบให้เอียงตาม polaroid
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.translate(-cx, -cy);
  // ถมสีพื้นหลังกลบ landscape ในช่องว่าง (กรอบใหญ่กว่า avatar)
  ctx.fillStyle = bgColor;
  ctx.fillRect(
    C.frameCoverPos.x,
    C.frameCoverPos.y,
    C.frameCoverSize.w,
    C.frameCoverSize.h,
  );
  // clip กรอบ avatar + วาด avatar แบบ cover (ขนาดพอดี ไม่ขยาย)
  ctx.beginPath();
  if (C.avatarCircle) ctx.arc(cx, cy, Math.min(bw, bh) / 2, 0, Math.PI * 2);
  else ctx.rect(bx, by, bw, bh);
  ctx.clip();
  ctx.drawImage(avatar, dx, dy, dw, dh);
  ctx.restore();

  // ข้อความ — anchor มุมซ้ายบน
  ctx.textBaseline = "top";
  ctx.fillStyle = C.textColor;
  ctx.font = `${C.fontSize}px "${C.fontFamily}"`;

  const no = `${C.noPrefix}${String(card.member_number).padStart(C.idZeroFill, "0")}`;
  ctx.fillText(no, C.noPos.x, C.noPos.y);
  ctx.fillText(userId, C.memberIdPos.x, C.memberIdPos.y); // Member ID = Discord ID
  ctx.fillText(username, C.namePos.x, C.namePos.y);
  ctx.fillText(card.join_date || "-", C.joinPos.x, C.joinPos.y);
  ctx.fillText(card.status || "-", C.statusPos.x, C.statusPos.y);

  // เลเวลจากระบบ activity — ตัวหนา วางบนเส้นประล่างสุด
  ctx.font = `${C.levelFontSize}px "${C.fontBoldFamily}"`;
  ctx.fillText(`LV. ${level}`, C.levelPos.x, C.levelPos.y);

  // bias — วาดต่อจากเลเวลเฉพาะเมื่อตั้งค่าไว้ (ค่าเริ่มต้น "-" = ไม่วาด)
  if (card.bias && card.bias !== "-") {
    ctx.font = `${C.fontSize}px "${C.fontFamily}"`;
    ctx.fillText(`Bias: ${card.bias}`, C.biasPos.x, C.biasPos.y);
  }

  return canvas.toBuffer("image/png");
}
