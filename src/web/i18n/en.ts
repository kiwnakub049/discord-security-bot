/**
 * คำแปลอังกฤษของข้อความที่ server ตอบหน้าเว็บ
 * EXACT: ข้อความไทยตรงตัว → อังกฤษ
 * PATTERNS: [regex, แทนที่] — แทนที่เป็นสตริงใช้ $1 $2 ได้ · เป็นฟังก์ชันได้ (sub = แปลชิ้นย่อยต่อ)
 *
 * ชื่อคน/หัวข้อเรื่อง/ข้อความจาก Discord ที่ปนมาในข้อความ = ข้อมูล ไม่แปล
 */
export const EXACT: Record<string, string> = {
  /* ---------- ทั่วไป ---------- */
  "ข้อมูลไม่ครบ": "Missing information",
  "ข้อมูลไม่ถูกต้อง": "Invalid data",
  "ไม่พบเซิร์ฟเวอร์": "Server not found",
  "ไม่พบสมาชิกในเซิร์ฟเวอร์": "Member not found in the server",
  "ไม่พบสมาชิกในเซิร์ฟเวอร์ (อาจออกไปแล้ว)": "Member not found in the server (they may have left)",
  "ทำไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)": "Failed (check the bot's permissions/role order)",
  "บอทไม่ได้เชื่อมต่อ Discord": "The bot isn't connected to Discord",
  "ต้องเป็น admin": "Admins only",
  "ส่วนนี้ไม่เปิดให้ admin": "This section isn't available to admins",

  /* ---------- ปฏิบัติการกับสมาชิก ---------- */
  "ปลด timeout แล้ว": "Timeout removed",
  "ไม่มีเตือนให้ลบ": "No warnings to clear",
  "ปลดไมค์แดงแล้ว": "Server mute lifted",
  "ยกเลิกโทษแล้ว — ตอนนี้อยู่นอกห้องเสียง บอทจะปลดไมค์ให้ทันทีที่เข้าห้อง":
    "Punishment cancelled — they're not in voice right now; the bot will unmute them as soon as they join",
  "ไม่ได้โดนไมค์แดงอยู่": "Not currently server-muted",
  "ปลดไม่สำเร็จ (เช็คสิทธิ์ Mute Members ของบอท)": "Couldn't unmute (check the bot's Mute Members permission)",
  "→ รอ mod ยืนยันแบน (อยู่ในคิวบน dashboard)": "→ awaiting mod ban approval (in the dashboard queue)",
  "→ ลงโทษ: แบน": "→ punishment: ban",
  "→ ⚠️ ลงโทษอัตโนมัติไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)":
    "→ ⚠️ automatic punishment failed (check the bot's permissions/role order)",
  "📨 DM แล้ว": "📨 DM sent",
  "(DM ไม่ได้)": "(couldn't DM)",

  /* ---------- ตั้งค่า / จอ OLED ---------- */
  "บันทึกการตั้งค่าแล้ว": "Settings saved",
  "เขียนไฟล์ตั้งค่าจอไม่ได้ (สิทธิ์?)": "Couldn't write the display config file (permissions?)",

  /* ---------- คำตัดสิน AI ---------- */
  "logId ไม่ถูกต้อง": "Invalid logId",
  "ยกเลิกแล้ว": "Cancelled",
  "ไม่มีให้ยกเลิก": "Nothing to cancel",
  "verdict ต้องเป็น toxic, ok หรือ null": "verdict must be toxic, ok or null",
  "comment ต้องเป็นข้อความ": "comment must be text",
  "ไม่พบการตรวจจับของ AI ตาม id นี้": "No AI detection found with this id",
  "ตัดสินได้เฉพาะข้อความที่บอทลบไปแล้ว": "You can only rate messages the bot deleted",
  "log นี้ไม่มีข้อความ/คะแนนให้เก็บ": "This log has no message/score to store",

  /* ---------- BeamMP ---------- */
  "ต่อ agent ไม่ได้ — เช็ค: systemctl status beammp-agent": "Can't reach the agent — check: systemctl status beammp-agent",
  "agent ไม่ตอบสตรีม": "The agent didn't respond to the stream",

  /* ---------- ผู้ช่วย AI ---------- */
  "Claude กำลังตอบคำถามก่อนหน้าอยู่": "Claude is still answering the previous question",
  "ไม่พบแชทนี้": "Chat not found",
  "รอ Claude ตอบเสร็จก่อนค่อยลบ": "Wait for Claude to finish before deleting",
  "ลบแชทแล้ว": "Chat deleted",
  "ไม่พบข้อเสนอนี้": "Proposal not found",
  "API key ไม่ถูกต้อง (เช็ค ANTHROPIC_API_KEY ใน .env)": "Invalid API key (check ANTHROPIC_API_KEY in .env)",
  "ติด rate limit ของ Claude API — รอสักครู่แล้วลองใหม่": "Hit the Claude API rate limit — wait a moment and try again",
  "Claude ตอบช้าเกินไป — ลองใหม่อีกครั้ง": "Claude took too long — try again",
  "เชื่อมต่อ Claude API ไม่ได้": "Can't connect to the Claude API",
  "เกิดข้อผิดพลาด": "Something went wrong",
  "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน .env": "ANTHROPIC_API_KEY isn't set in .env",
  "บอทไม่ได้เชื่อมต่อเซิร์ฟเวอร์": "The bot isn't connected to the server",
  "query ว่าง": "Empty query",
  "user_id ต้องเป็นตัวเลข Discord id": "user_id must be a numeric Discord id",
  "action ไม่ถูกต้อง": "Invalid action",
  "ต้องมีเหตุผล": "A reason is required",
  // ป้ายเครื่องมือที่ Claude ใช้ (โชว์ระหว่างทาง)
  "ดูภาพรวมเซิร์ฟ": "Viewed server overview",
  "นับ log แยกชนิด": "Counted logs by type",
  "ค้น log": "Searched logs",
  "ค้นหาสมาชิก": "Searched members",
  "ดูประวัติสมาชิก": "Viewed member history",
  "ดูคนโดนเตือนเยอะสุด": "Viewed most-warned members",
  "ดูคิวที่ค้าง": "Viewed open queue",

  /* ---------- คิวรอดำเนินการ / ticket ---------- */
  "ไม่มีหมวดนี้": "No such category",
  "ไม่พบ ticket นี้": "Ticket not found",
  "ticket นี้ถูกปิดไปแล้ว": "This ticket is already closed",
  "บอทไม่ได้ต่อ Discord อยู่ ส่ง DM ไม่ได้": "The bot isn't connected to Discord, so it can't send DMs",
  "ส่งถึงตำรวจทาง DM แล้ว": "Delivered to the officer by DM",
  "บันทึกแล้ว แต่ DM ไม่ถึง (ตำรวจอาจปิด DM)": "Saved, but the DM didn't go through (the officer may have DMs off)",
  "ไม่พบเรื่องนี้หรือตัวเลือกไม่ถูกต้อง": "Item not found or invalid option",
  "ลบไม่ได้: บอทไม่ได้เชื่อมต่อ Discord": "Can't delete: the bot isn't connected to Discord",
  "แบนไม่ได้: ไม่พบเซิร์ฟเวอร์หรือไม่รู้ว่าเป็นใคร": "Can't ban: server not found or unknown user",
  "แบนไม่สำเร็จ (เช็คสิทธิ์/ลำดับ role ของบอท)": "Ban failed (check the bot's permissions/role order)",
  "เรื่องนี้ถูกตัดสินไปแล้ว": "This item has already been decided",
  "คนอื่น": "someone else",
  // หมวด (ป้าย / กริยา / ลักษณนาม)
  "รอยืนยันแบน": "Ban approval",
  "ตรวจการแบน": "Review",
  "ราย": "bans",
  "สมาชิกใหม่น่าสงสัย": "Suspicious new members",
  "ตรวจบัญชี": "Review",
  "บัญชี": "accounts",
  "Claude จับข้อความ": "Flagged by Claude",
  "ตรวจข้อความ": "Review",
  "ข้อความ": "messages",
  "AI สงสัย spam": "Possible spam (AI)",
  "Ticket แอดมิน": "Admin tickets",
  "เปิด ticket": "Open",
  "เรื่อง": "tickets",
  // ปุ่ม
  "ยืนยันแบน": "Confirm ban",
  "ไม่แบน": "Don't ban",
  "แบน": "Ban",
  "ปกติ ปล่อยผ่าน": "Looks fine, allow",
  "Timeout 1 ชม.": "Timeout 1 h",
  "เตือน": "Warn",
  "ปล่อยผ่าน (Claude ผิด)": "Allow (Claude was wrong)",
  "ลบ + แบน": "Delete + ban",
  "ลบข้อความ": "Delete message",
  "ปิด ticket": "Close ticket",
  // ผลหลังกด
  "แบนแล้ว": "Banned",
  "ยกเลิกคำขอแบนแล้ว": "Ban request cancelled",
  "ปล่อยผ่านแล้ว": "Allowed",
  "timeout 1 ชม. แล้ว": "Timed out for 1 h",
  "เตือนแล้ว": "Warned",
  "ลบข้อความและแบนแล้ว": "Message deleted and user banned",
  "ลบข้อความแล้ว": "Message deleted",
  "ปิด ticket แล้ว": "Ticket closed",

  /* ---------- อุปกรณ์ที่ login ---------- */
  "ไม่ได้ระบุเครื่อง": "No device specified",
  "นี่คือเครื่องที่ใช้อยู่ — ใช้ปุ่มออกจากระบบแทน": "This is your current device — use Sign out instead",
  "เตะเครื่องนั้นออกแล้ว": "That device has been signed out",
  "ไม่พบเครื่องนี้": "Device not found",
  "ไม่มีเครื่องอื่นที่ค้างอยู่": "No other devices are signed in",
  "ไม่ทราบ": "Unknown",
  "เครื่องมือบรรทัดคำสั่ง": "Command-line tool",

  /* ---------- แชททีม ---------- */
  "ไม่พบห้องนี้": "Room not found",
  "ส่งไม่สำเร็จ": "Couldn't send",
  "ไฟล์แนบไม่ถูกต้อง": "Invalid attachment",
  "ไม่รู้ขนาดไฟล์": "Unknown file size",
  "ไฟล์ใหญ่เกิน 100 MB": "File is larger than 100 MB",
  "อัปโหลดไม่สำเร็จ": "Upload failed",
  "ไม่พบไฟล์": "File not found",

  /* ---------- ระบบที่ปิดอยู่ (โหมดไม่มี privileged intent) ---------- */
  "anti-raid (ตรวจคนเข้าเซิร์ฟเวอร์รัว ๆ)": "anti-raid (join flood detection)",
  "log เข้า-ออกเซิร์ฟเวอร์": "join/leave logs",
  "auto-mod (คำต้องห้าม / ลิงก์เชิญ)": "auto-mod (banned words / invite links)",
  "AI จับข้อความ toxic": "AI toxic message detection",
  "anti-spam เฉพาะการจับข้อความซ้ำ (การจับส่งรัวและ mention เยอะ ยังทำงาน)":
    "anti-spam duplicate-message detection (rapid posting and mass-mention detection still work)",

  /* ---------- หัวตาราง CSV ---------- */
  "เวลา": "Time",
  "ระดับ": "Level",
  "หมวด": "Category",
  "เหตุการณ์": "Event",
  "หัวข้อ": "Title",
  "รายละเอียด": "Description",
  "ข้อมูลเพิ่มเติม": "Details",
  /* ---------- หน้าตั้งค่าบอท (หัวข้อ / ป้ายช่อง) ---------- */
  "ยกเว้น / Role": "Exemptions / Roles",
  "สิทธิ์เข้า dashboard": "Dashboard access",
  "เปิดใช้งาน": "Enabled",
  "คนเข้าเกิน (คน)": "Joins above (people)",
  "ภายใน (มิลลิวินาที)": "Within (milliseconds)",
  "อายุ account ที่น่าสงสัย (ms)": "Suspicious account age (ms)",
  "การลงโทษ": "Action",
  "ข้อความสูงสุด/หน้าต่าง": "Max messages per window",
  "หน้าต่างเวลา (ms)": "Time window (ms)",
  "mention สูงสุด/ข้อความ": "Max mentions per message",
  "ข้อความซ้ำสูงสุด": "Max duplicate messages",
  "timeout (ms)": "Timeout (ms)",
  "บล็อก invite เซิร์ฟเวอร์อื่น": "Block invites to other servers",
  "บล็อกลิงก์ phishing": "Block phishing links",
  "ลบข้อความที่ผิดทันที": "Delete violating messages immediately",
  "ลบไฟล์แนบอันตราย (.exe ฯลฯ)": "Delete dangerous attachments (.exe etc.)",
  "เตือนลิงก์ย่อ/paste (ไม่ลบ)": "Flag shortened/paste links (no delete)",
  "คำต้องห้าม": "Banned words",
  "คะแนนเริ่มโซน review (0–1)": "Review zone starts at score (0–1)",
  "คะแนนเริ่มโซน auto — ลบ+เตือน (0–1)": "Auto zone starts at score — delete + warn (0–1)",
  "timeout เรียก API (ms)": "API call timeout (ms)",
  "ลบข้อความโซน auto ทันที": "Delete auto-zone messages immediately",
  "คะแนนที่ลบเลย (0–1, 0=ปิด)": "Delete at score (0–1, 0 = off)",
  "ความยาวขั้นต่ำที่ส่งตรวจ (ตัวอักษร)": "Minimum length to check (characters)",
  "จับ spam (scam/โฆษณา/เลี่ยงฟิลเตอร์) ส่งเข้าคิว": "Detect spam (scam/ads/filter evasion) and queue it",
  "คะแนน spam ที่ส่งเข้าคิว (0–1)": "Spam score to queue (0–1)",
  "เข้า-ออกเซิร์ฟเวอร์": "Server joins/leaves",
  "ห้องเสียง": "Voice channels",
  "เก็บ log กี่วัน (0 = ตลอด)": "Keep logs for (days, 0 = forever)",
  "ห้อง log (channel ID)": "Log channel (channel ID)",
  "role ที่ยกเว้น (role ID)": "Exempt roles (role ID)",
  "user ที่ยกเว้น (user ID)": "Exempt users (user ID)",
  "role คนมีบัตร (role ID)": "Card-holder role (role ID)",
  "ยศที่เป็น admin (role ID) — คนมีสิทธิ์ Administrator เป็น admin เสมอ":
    "Admin roles (role ID) — anyone with the Administrator permission is always an admin",
  "ยศที่เป็น mod (role ID)": "Mod roles (role ID)",
  "ยศตำรวจที่เปิด ticket ได้ (role ID)": "Police role that can open tickets (role ID)",
  "เปิดระบบเตือน": "Enable warnings",
  "เตือนครบแล้วรอ mod ยืนยันก่อนแบน": "Require mod approval before auto-ban",
  "เปิดระบบ XP": "Enable XP",
  "XP ต่อข้อความ": "XP per message",
  "cooldown ข้อความ (ms)": "Message cooldown (ms)",
  "XP ต่อนาที (ห้องเสียง)": "XP per minute (voice)",
  "นับเวลาแม้ปิดไมค์": "Count time while muted",

  /* ---------- จอ OLED ---------- */
  "โหลด — CPU / RAM": "Load — CPU / RAM",
  "ความร้อน — อุณหภูมิ / พัดลม / ไฟ": "Thermal — temperature / fan / power",
  "เครือข่าย — IP / ปริมาณข้อมูล": "Network — IP / traffic",

  /* ---------- BeamMP (ป้ายช่อง / ที่อยู่ / error จาก agent) ---------- */
  "ชื่อเซิร์ฟเวอร์": "Server name",
  "คำอธิบาย": "Description",
  "แผนที่": "Map",
  "ผู้เล่นสูงสุด": "Max players",
  "รถต่อคน": "Cars per player",
  "แท็ก": "Tags",
  "ไม่ประกาศในรายการสาธารณะ": "Hide from the public server list",
  "ให้ guest เข้าได้": "Allow guests",
  "บันทึกแชทลง log": "Log chat",
  "โหมด debug": "Debug mode",
  "ผ่าน Tailscale": "Via Tailscale",
  "อ่านไฟล์ตั้งค่าไม่ได้": "Couldn't read the config file",
  "รูปแบบข้อมูลไม่ถูกต้อง": "Invalid data format",
  "เขียนไฟล์ไม่ได้": "Couldn't write the file",
  "offset ไม่ถูกต้อง": "Invalid offset",
  "ไฟล์นี้ไม่ใช่ zip": "This file isn't a zip",
  "แผนที่: ต้องเป็นข้อความ": "Map: must be text",
  "แผนที่: ต้องเป็นรูปแบบ /levels/<ชื่อ>/info.json": "Map: must look like /levels/<name>/info.json",
  "แผนที่: ชื่อโฟลเดอร์ใช้ไม่ได้": "Map: invalid folder name",
  "ชื่อไฟล์ใช้ไม่ได้": "Invalid file name",
  "ไม่พบไฟล์นี้": "File not found",
  "เซิร์ฟเวอร์รันอยู่แล้ว": "The server is already running",
  "ไม่พบไฟล์ BeamMP-Server": "BeamMP-Server binary not found",
  "ยังไม่ได้ตั้ง AuthKey ใน ServerConfig.toml": "AuthKey isn't set in ServerConfig.toml",
  "เซิร์ฟเวอร์ไม่ได้รันอยู่": "The server isn't running",
  "ชื่อไฟล์ใช้ไม่ได้ — ต้องเป็นไฟล์ .zip": "Invalid file name — must be a .zip file",
  "ไม่พบรายการอัปโหลดนี้ (อาจหมดเวลาไปแล้ว)": "Upload not found (it may have timed out)",
  "ส่งก้อนข้อมูลไม่สำเร็จ": "Couldn't send the chunk",
  "ไม่พบรายการอัปโหลดนี้": "Upload not found",
  "ไฟล์ว่าง": "Empty file",
};

type Replacer = string | ((m: RegExpExecArray, sub: (s: string) => string) => string);

/** countdown ท้ายข้อความโทษ " — ปลดให้ <t:…:R>" */
const lift = (s: string | undefined) => (s ? s.replace(" — ปลดให้ ", " — lifted ") : "");

export const PATTERNS: [RegExp, Replacer][] = [
  /* ---------- ปฏิบัติการกับสมาชิก ---------- */
  [
    /^(แบนแล้ว|เตะออกแล้ว|timeout (\d+) นาที)(?: (📨 DM แล้ว|\(DM ไม่ได้\)))?$/,
    (m, sub) =>
      [
        m[1] === "แบนแล้ว" ? "Banned" : m[1] === "เตะออกแล้ว" ? "Kicked" : `Timed out for ${m[2]} min`,
        m[3] ? sub(m[3]) : "",
      ]
        .join(" ")
        .trim(),
  ],
  [
    /^เตือนแล้ว \(ครั้งที่ (\d+)\) ?(.*?) ?(📨 DM แล้ว|\(DM ไม่ได้\))$/,
    (m, sub) => [`Warned (#${m[1]})`, m[2] ? sub(m[2]) : "", sub(m[3]!)].filter(Boolean).join(" "),
  ],
  [/^→ ลงโทษ: ไมค์แดง (\d+) ชม\. \(ยังไม่อยู่ห้องเสียง — จะปิดทันทีที่เข้า\)(.*)$/, (m) => `→ punishment: server mute ${m[1]} h (not in voice yet — applies as soon as they join)${lift(m[2])}`],
  [/^→ ลงโทษ: ไมค์แดง (\d+) ชม\.(.*)$/, (m) => `→ punishment: server mute ${m[1]} h${lift(m[2])}`],
  [/^→ ลงโทษ: timeout (\d+) ชม\.(.*)$/, (m) => `→ punishment: timeout ${m[1]} h${lift(m[2])}`],
  [/^ล้างเตือน (\d+) ครั้ง$/, "Cleared $1 warning(s)"],
  [
    /^(ปลดล็อก|ล็อก) (\d+) ห้อง(?: \(พลาด (\d+)\))?$/,
    (m) => `${m[1] === "ปลดล็อก" ? "Unlocked" : "Locked"} ${m[2]} channel(s)${m[3] ? ` (${m[3]} failed)` : ""}`,
  ],

  /* ---------- ตั้งค่า / จอ ---------- */
  [/^หน้าจอต้องเป็นหนึ่งใน (.+)$/, "The screen must be one of $1"],
  [/^จอค้างที่หน้า (.+) แล้ว$/, "Display pinned to page $1"],

  /* ---------- AI / ผู้ช่วย ---------- */
  [/^ใส่ข้อความ 1–(\d+) ตัวอักษร$/, "Enter 1–$1 characters"],
  [/^พิมพ์คำถาม \(ไม่เกิน (\d+) ตัวอักษร\)$/, "Type a question (up to $1 characters)"],
  [/^Claude API ผิดพลาด \((.+)\)$/, "Claude API error ($1)"],
  [/^ไม่มี tool ชื่อ (.+)$/, "No tool named $1"],

  /* ---------- คิว / ticket ---------- */
  [/^ข้อความต้องยาว 1–(\d+) ตัวอักษร$/, "Message must be 1–$1 characters"],
  [/^เรื่องนี้ถูกตัดสินไปแล้วโดย (.+)$/, (m, sub) => `Already decided by ${sub(m[1]!)}`],
  [/^ลบไม่ได้ (\d+) ข้อความ \(เช็คสิทธิ์ Manage Messages ของบอท\)$/, "Couldn't delete $1 message(s) (check the bot's Manage Messages permission)"],
  [/^ \(ลบ (\d+) ข้อความ(?: · หายไปก่อนแล้ว (\d+))?\)$/, (m) => ` (deleted ${m[1]}${m[2] ? ` · ${m[2]} already gone` : ""})`],
  [/^ \(ครั้งที่ (\d+)(?: (.+))?\)$/, (m, sub) => ` (#${m[1]}${m[2] ? ` ${sub(m[2])}` : ""})`],

  /* ---------- อุปกรณ์ ---------- */
  [/^เตะออก (\d+) เครื่อง$/, "Signed out $1 device(s)"],

  /* ---------- แชททีม ---------- */
  [/^ข้อความ 1–(\d+) ตัวอักษร หรือแนบไฟล์ได้ไม่เกิน (\d+) ไฟล์$/, "Message must be 1–$1 characters, or attach up to $2 files"],
  /* ---------- BeamMP ---------- */
  [/^ในบ้าน \((.+)\)$/, "Home network ($1)"],
  [/^แก้ค่า "(.+)" จากหน้าเว็บไม่ได้$/, 'Setting "$1" can\'t be changed from the web'],
  [/^ไม่พบไฟล์ตั้งค่า: (.+)$/, "Config file not found: $1"],
  [/^ไม่พบค่าเหล่านี้ในไฟล์: (.+)$/, "These keys are missing from the file: $1"],
  [/^ไฟล์ใหญ่เกิน (\d+) GB$/, "File is larger than $1 GB"],
  [/^ก้อนข้อมูลมาไม่ตรงลำดับ \(คาดว่า (\d+) ได้ (\d+)\)$/, "Chunk out of order (expected $1, got $2)"],
  // error ตรวจค่าตั้ง "<ป้ายช่อง>: <ปัญหา>" — หลายอันต่อกันด้วย " · "
  [
    /^[^:·]+: (?:ต้องเป็น true\/false|ต้องเป็นจำนวนเต็ม|ต้องอยู่ระหว่าง \d+–\d+|ต้องเป็นข้อความ|ยาวเกิน \d+ ตัวอักษร|ห้ามขึ้นบรรทัดใหม่)(?: · .+)?$/,
    (m, sub) =>
      m[0]
        .split(" · ")
        .map((part) => {
          const i = part.indexOf(": ");
          if (i < 0) return sub(part);
          const what = part.slice(i + 2)
            .replace("ต้องเป็น true/false", "must be true/false")
            .replace("ต้องเป็นจำนวนเต็ม", "must be a whole number")
            .replace(/ต้องอยู่ระหว่าง (\d+)–(\d+)/, "must be between $1–$2")
            .replace("ต้องเป็นข้อความ", "must be text")
            .replace(/ยาวเกิน (\d+) ตัวอักษร/, "longer than $1 characters")
            .replace("ห้ามขึ้นบรรทัดใหม่", "must not contain line breaks");
          return `${sub(part.slice(0, i))}: ${what}`;
        })
        .join(" · "),
  ],
];
