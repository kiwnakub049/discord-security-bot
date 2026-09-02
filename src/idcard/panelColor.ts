import {
  ButtonStyle,
  DiscordAPIError,
  type Client,
  type TextBasedChannel,
} from "discord.js";
import { panelButtonRow, panelEmbed } from "./idcardSetup.js";
import { listPanels, removePanel } from "./panelStore.js";

/**
 * ไล่สีขอบ embed ของแผงบัตรที่ปักไว้ให้ค่อย ๆ fade "เหลือง → เขียว → ฟ้า" วนกลับไปมา
 *
 * Discord ตรึงสี embed ตอนส่ง แก้ทีหลังไม่ได้ วิธีเดียวที่ทำให้สีขยับคือ edit
 * ข้อความแผงเดิมเป็นระยะ ลูปนี้จึงขยับ hue ทีละนิดแล้ว edit ทุกแผงที่จำไว้ทุก TICK_MS
 *
 * โทนพาสเทล: จำกัด hue ไว้ช่วงเหลือง(55°)→เขียว(130°)→ฟ้า(210°) แล้ว "เด้งกลับ"
 * (ping-pong) ไม่วิ่งรอบวงล้อสีเต็ม จะได้ไม่มีจังหวะกระโดดจากฟ้ากลับไปเหลืองแรง ๆ
 * S ต่ำ + L สูง = สีอ่อนแบบพาสเทล
 *
 * ปุ่ม: Discord ตั้งสีปุ่มเป็น hex ไม่ได้ เลยได้แค่สลับ เขียว(Success)/น้ำเงิน(Primary)
 * ตามว่าตอนนี้อยู่โทนเขียว-เหลือง หรือโทนฟ้า — ไม่ fade เนียนเหมือน embed
 */
const TICK_MS = 8_000; // 8 วิ/ก้าว — fade ช้านุ่ม ปลอดภัยจาก rate limit สบาย ๆ
const HUE_MIN = 55; // เหลือง
const HUE_MAX = 210; // ฟ้า
const STEP = 9; // องศาต่อก้าว — ยิ่งน้อยยิ่งเนียน แต่กว่าจะครบรอบยิ่งนาน
const BUTTON_SWITCH_HUE = 165; // ต่ำกว่านี้ = ปุ่มเขียว, สูงกว่า = ปุ่มน้ำเงิน

let hue = HUE_MIN;
let dir = 1; // +1 ไล่ขึ้นหาฟ้า, -1 ไล่ลงหาเหลือง

/** ขยับ hue หนึ่งก้าวแบบเด้งกลับที่ขอบช่วง แล้วคืนค่าใหม่ */
function stepHue(): number {
  hue += dir * STEP;
  if (hue >= HUE_MAX) {
    hue = HUE_MAX;
    dir = -1;
  } else if (hue <= HUE_MIN) {
    hue = HUE_MIN;
    dir = 1;
  }
  return hue;
}

/** HSL → เลขสี 0xRRGGBB (พาสเทล: S ต่ำ L สูง) */
function hslToInt(h: number, s = 0.5, l = 0.8): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (v: number): number => Math.round((v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

/** แก้สี+สไตล์ปุ่มของแผงหนึ่งอัน — คืน false ถ้าแผงหาย/แก้ไม่ได้ (ให้ลบทิ้ง) */
async function paintPanel(
  client: Client,
  ref: { channelId: string; messageId: string },
  color: number,
  buttonStyle: ButtonStyle,
): Promise<boolean> {
  try {
    const channel = (await client.channels.fetch(
      ref.channelId,
    )) as TextBasedChannel | null;
    if (!channel || !channel.isTextBased()) return false;
    const msg = await channel.messages.fetch(ref.messageId);
    // แบนเนอร์ที่ติดข้อความอยู่แล้วไม่ถูกแตะ (ไม่ได้ส่ง files)
    await msg.edit({
      embeds: [panelEmbed(color)],
      components: [panelButtonRow(buttonStyle)],
    });
    return true;
  } catch (err) {
    // 10003 Unknown Channel / 10008 Unknown Message = แผงถูกลบไปแล้ว → เลิกตาม
    if (err instanceof DiscordAPIError && (err.code === 10008 || err.code === 10003)) {
      return false;
    }
    // error ชั่วคราวอื่น ๆ (เน็ต/rate limit) — เก็บแผงไว้ ลองรอบหน้า
    console.error("ไล่สีแผงบัตรไม่สำเร็จ:", err);
    return true;
  }
}

/**
 * เริ่มลูป fade สีแผงบัตร — เรียกครั้งเดียวตอนบอทออนไลน์ (ready)
 * ไม่มีแผงในทะเบียนก็ไม่เสียอะไร ลูปแค่วนเปล่า ๆ เบามาก
 */
export function startPanelColorCycle(client: Client): void {
  setInterval(() => {
    const panels = listPanels();
    if (!panels.length) return;
    const h = stepHue();
    const color = hslToInt(h);
    const buttonStyle =
      h < BUTTON_SWITCH_HUE ? ButtonStyle.Success : ButtonStyle.Primary;
    for (const ref of panels) {
      void paintPanel(client, ref, color, buttonStyle).then((ok) => {
        if (!ok) removePanel(ref.messageId);
      });
    }
  }, TICK_MS).unref();
}
