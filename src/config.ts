/**
 * ค่าตั้งทั้งหมดของบอทรวมไว้ที่นี่ที่เดียว ปรับได้ตามใจ
 * ทุก threshold มีคอมเมนต์อธิบายว่ามันคุมอะไร
 * หมายเหตุ: ค่าบางส่วนแก้ได้สดจากหน้า Settings (เก็บทับใน data/settings.json)
 */
export const config = {
  /**
   * Anti-raid: ตรวจจับคนเข้าเซิร์ฟเวอร์พร้อมกันเยอะผิดปกติ
   */
  antiRaid: {
    enabled: true,
    // ถ้ามีคนเข้าเกิน joinThreshold คน ภายใน joinWindowMs มิลลิวินาที => ถือว่าเป็น raid
    joinThreshold: 8,
    joinWindowMs: 10_000, // 10 วินาที
    // account ที่อายุน้อยกว่านี้ถือว่าน่าสงสัย (มิลลิวินาที) — ค่าเริ่มต้น 7 วัน
    minAccountAgeMs: 7 * 24 * 60 * 60 * 1000,
    // ตอน raid ให้ทำอะไร: 'kick' | 'ban' | 'lockdown' (แค่ล็อกห้อง ไม่เตะ)
    action: "kick" as "kick" | "ban" | "lockdown",
  },

  /**
   * Anti-spam: จับการส่งข้อความถี่เกินไป / ซ้ำ / mention เยอะ
   */
  antiSpam: {
    enabled: true,
    // ส่งข้อความเกิน maxMessages ข้อความ ภายใน windowMs => spam
    maxMessages: 5,
    windowMs: 5_000, // 5 วินาที
    // ส่งข้อความเนื้อหาเหมือนกันซ้ำเกินจำนวนนี้ => spam
    maxDuplicates: 3,
    // mention (@user / @role) เกินจำนวนนี้ในข้อความเดียว => ลงโทษ
    maxMentions: 5,
    // ลงโทษ: timeout (mute ชั่วคราว) กี่มิลลิวินาที
    timeoutMs: 5 * 60 * 1000, // 5 นาที
  },

  /**
   * Auto-mod: กรองลิงก์อันตราย / invite เซิร์ฟเวอร์อื่น / คำต้องห้าม
   */
  autoMod: {
    enabled: true,
    blockInvites: true, // บล็อก discord.gg/... ของเซิร์ฟเวอร์อื่น
    blockPhishing: true, // บล็อกโดเมนหลอกลวงที่รู้จัก
    // คำต้องห้าม (เพิ่มได้) — match แบบไม่สนตัวพิมพ์เล็ก/ใหญ่
    bannedWords: [] as string[],
    // ถ้า true จะลบข้อความที่ผิดทันที
    deleteOnViolation: true,
    // ลบไฟล์แนบนามสกุลอันตราย (.exe .scr .lnk ฯลฯ) — ช่องแพร่ XWorm/RAT ใน Discord
    blockDangerousFiles: true,
    // เตือน mod เมื่อมีลิงก์ย่อ/paste (bit.ly ฯลฯ) — เตือนอย่างเดียว ไม่ลบ
    flagShorteners: true,
  },

  /**
   * AI mod: ส่งข้อความให้ Claude API (Anthropic) ตัดสินว่า toxic ไหม
   * ช่วยตัดสินต่อจาก auto-mod — โซน "auto" ลงโทษเอง, โซน "review" ขึ้น dashboard
   * API key อ่านจาก env ANTHROPIC_API_KEY (.env) — ไม่มี key = ปล่อยข้อความผ่าน (fail-open)
   */
  aiMod: {
    enabled: true,
    // ทุกข้อความที่ผ่าน autoMod/antiSpam ถูกส่งตรวจ — ใช้ Haiku เพราะถูกกว่า Opus ราว 40 เท่า
    // (ถ้าความแม่นไม่พอค่อยขยับเป็น "claude-sonnet-5-5" หรือ "claude-opus-5-5")
    model: "claude-haiku-5-5",
    // งาน classify สั้น ๆ ไม่ต้องคิดลึก — low = เร็วและถูกสุด
    effort: "low" as "low" | "medium" | "high",
    // คะแนน (0–1) จาก AI → โซน: >= autoScore = auto, >= reviewScore = review, ต่ำกว่า = ignore
    reviewScore: 0.5,
    autoScore: 0.9,
    // เกินนี้ถือว่า API ไม่ตอบ => ปล่อยข้อความผ่าน (fail-open)
    timeoutMs: 15_000,
    // ลบข้อความทันทีเมื่อเข้าโซน auto
    deleteOnAuto: true,
    // โซน "review" ที่คะแนนถึงค่านี้ = ลบข้อความเลย (แต่ไม่เตือน/ลงโทษ ต่างจากโซน auto)
    // เพราะคำหยาบชัด ๆ ที่ได้คะแนนกลาง-สูงถ้าแค่ขึ้น dashboard = "เจอแต่ไม่ทำอะไร"
    // ตั้ง 0 เพื่อปิด (กลับไปแค่ขึ้น dashboard)
    // ความแม่นโซนนี้ไม่พอจะลงโทษถาวร เลยแค่ "ลบ" ไม่เตือน/ไม่ไมค์แดง
    reviewDeleteScore: 0.75,
    // ข้อความสั้นกว่านี้ (ตัวอักษร) ไม่ส่งตรวจ
    minLength: 2,
    // spam เชิงเนื้อหา (scam / โฆษณา / เลี่ยงฟิลเตอร์) — ไม่ลบเอง แค่ส่งการ์ดเข้าคิวให้ mod
    spamEnabled: true,
    // คะแนน spam (0–1) ตั้งแต่ค่านี้ขึ้นการ์ด — ตั้งสูงไว้กันคิวท่วม
    spamReviewScore: 0.7,
  },

  /**
   * ผู้ช่วย AI หน้าแชท dashboard (เฉพาะ admin) — ใช้ ANTHROPIC_API_KEY เดียวกับ aiMod
   * Claude อ่านข้อมูลเซิร์ฟได้ และ "เสนอ" การลงโทษให้ admin กดยืนยัน — ลงมือเองไม่ได้
   */
  assistant: {
    model: "claude-opus-5-5",
    // งานค้นข้อมูลหลายขั้น + สรุป — medium พอดี ถ้าตอบตื้นไปค่อยขยับเป็น high
    effort: "medium" as "low" | "medium" | "high",
  },

  /**
   * Audit logging: บันทึกเหตุการณ์ในเซิร์ฟเวอร์ (ขึ้นทั้งหน้าเว็บ + ห้อง log)
   */
  logging: {
    memberJoinLeave: true, // คนเข้า/ออกเซิร์ฟเวอร์
    voice: true, // เข้า/ออก/ย้ายห้องเสียง
    // การใช้ permission ผ่าน audit log: ban, kick, แก้ role, แก้สิทธิ์ห้อง ฯลฯ
    // ⚠️ บอทต้องมีสิทธิ์ "View Audit Log" ในเซิร์ฟเวอร์ ถึงจะรับ event นี้ได้
    auditLog: true,
    // เก็บ log ในฐานข้อมูลกี่วัน แล้วลบทิ้งอัตโนมัติ (0 = เก็บตลอด ไม่ลบ)
    retentionDays: 90,
  },

  /**
   * Logging: ส่ง log เหตุการณ์สำคัญไปที่ห้องนี้
   * ใส่ channel ID ของห้อง log (เปิด Developer Mode แล้วคลิกขวาที่ห้อง -> Copy Channel ID)
   * ถ้าเว้น "" ไว้ จะ log ลง console อย่างเดียว
   */
  logChannelId: "",

  /**
   * role/user ที่ได้รับการยกเว้น ไม่โดนตรวจสอบ (เช่น mod, บอทอื่น)
   * ใส่เป็น role ID หรือ user ID
   */
  exemptRoleIds: [] as string[],
  exemptUserIds: [] as string[],

  // role ที่ให้คนที่มีบัตรประจำตัว (มีบัตร=ได้ role, ไม่มี=เอาออก) — เว้น "" เพื่อปิดฟีเจอร์
  cardRoleId: "1135575696555655223",

  dashboard: {
    // ใครเข้า dashboard ได้ — ดูจากยศใน Discord ตอน login และทุก request (ถอดยศ = หลุดทันที)
    // คนที่มีสิทธิ์ Administrator ในเซิร์ฟเป็น admin เสมอ แม้ไม่ได้ตั้งยศไว้ตรงนี้
    // (กันล็อกตัวเองออก: ไม่มีรหัสผ่านสำรองแล้ว ถ้ายศว่างทั้งคู่เจ้าของเซิร์ฟยังเข้าได้)
    adminRoleIds: [] as string[], // admin = ตั้งค่าบอท + ทุกอย่างที่ mod ทำได้
    modRoleIds: [] as string[], // mod = ดู log + จัดการสมาชิก + ตัดสินคิว
  },

  ticket: {
    // ยศตำรวจที่เปิด /ticket ได้ — เว้น "" = ยังไม่มีใครเปิดได้
    // (ปลอดภัยกว่าเปิดให้ทุกคนตอนลืมตั้ง: ticket ส่งตรงถึงแอดมิน ไม่ควรเป็นกล่องรับเรื่องสาธารณะ)
    policeRoleId: "",
  },

  /**
   * Web dashboard: แสดง data-log บนเว็บแบบ real-time
   */
  web: {
    enabled: true,
    // override ด้วย WEB_PORT ได้ — ใช้ตอนอยากรันอีกตัวคู่กับของจริงที่ยังทำงานอยู่
    // (เช่นเปิด dashboard จากฐานข้อมูลตัวอย่างเพื่อถ่ายภาพประกอบ โดยไม่ต้องหยุดบอท)
    port: Number(process.env.WEB_PORT) || 3000,
    // interface ที่จะ bind:
    //  "127.0.0.1" = เข้าได้เฉพาะในเครื่อง (ปลอดภัยสุด — ใช้คู่กับ reverse proxy/SSH tunnel บน VPS)
    //  "0.0.0.0"   = เปิดออกเน็ตตรง ๆ (อันตราย ใช้เฉพาะตอนต้องการจริง ๆ และตั้ง authToken แล้ว)
    host: "127.0.0.1",
    // จำนวนชั้น reverse proxy ที่ "ไว้ใจ" สำหรับอ่าน IP จริงจาก X-Forwarded-For
    //  - อยู่หลัง Caddy/Cloudflare Tunnel 1 ชั้น (ตาม DEPLOY.md) => 1  ← ค่าเริ่มต้นที่ถูกต้อง
    //  - เข้าตรง ๆ ผ่าน SSH tunnel/loopback ไม่มี proxy => 0 (ไม่เชื่อ header ที่ client ปลอมได้เลย)
    // ⚠️ อย่าตั้ง true — จะเชื่อ X-Forwarded-For ทุกค่ารวมค่าที่ผู้โจมตีปลอม ทำให้ req.ip ปลอมได้
    //    → หลบการล็อก IP ตอน brute-force login ได้ทั้งหมด
    trustProxy: 1 as number | boolean,
    // ตั้ง true เมื่อมี HTTPS อยู่ข้างหน้าแล้ว (Caddy/Cloudflare Tunnel) — cookie จะส่งเฉพาะผ่าน HTTPS
    // ตอนทดสอบ local แบบ http ให้เป็น false ไม่งั้น browser จะไม่ส่ง cookie กลับ (login วนลูป)
    cookieSecure: process.env.COOKIE_SECURE === "1",
    // จำนวน log ที่เก็บในหน่วยความจำ/ส่งให้เว็บตอนเปิดครั้งแรก
    maxEntries: 500,
    // กัน brute-force หน้า login: ลองผิดเกิน loginMaxAttempts ครั้ง => ล็อก IP นั้น loginLockMs
    loginMaxAttempts: 5,
    loginLockMs: 15 * 60 * 1000, // 15 นาที
  },

  /**
   * ระบบเตือน (warning) + ลงโทษอัตโนมัติเมื่อสะสมครบจำนวน
   */
  warnings: {
    enabled: true,
    // true = เตือนครบขั้น 'ban' แล้วยังไม่แบน แต่ส่งเข้าคิว "รอยืนยันแบน" ให้ mod กดบน dashboard
    // แบนแก้คืนยากที่สุดในบรรดาโทษทั้งหมด และเตือนบางครั้งมาจาก AI ที่จับผิดได้ — ให้คนดูก่อนหนึ่งจังหวะ
    banRequiresApproval: true,
    // เมื่อจำนวนเตือนถึง count ให้ทำ action — เตือนเกินขั้นไหนแล้วใช้ขั้นสูงสุดที่ถึง
    // (เช่น ครั้งที่ 4 = ไมค์แดงอีกรอบ, ครั้งที่ 6 = timeout อีกรอบ, ครั้งที่ 8 ขึ้นไป = แบน)
    //   'mute'    = server mute เฉพาะเสียง (ไมค์แดง) ใส่ ms = ระยะเวลา — บอทปลดให้เองเมื่อครบ
    //               และถ้ามีคนไปปลดก่อนหมดเวลา บอทจะปิดกลับทันที (ดู muteEnforce)
    //   'timeout' = ระงับทั้งพิมพ์และพูด (Discord timeout) ใส่ ms = ระยะเวลา
    //   'ban'     = แบนออกจากเซิร์ฟเวอร์
    escalation: [
      { count: 3, action: "mute", ms: 60 * 60 * 1000 }, // 3 ครั้ง: ไมค์แดง 1 ชม.
      { count: 5, action: "timeout", ms: 24 * 60 * 60 * 1000 }, // 5 ครั้ง: timeout 1 วัน
      { count: 7, action: "ban" }, // 7 ครั้ง: แบน
    ] as { count: number; action: "mute" | "timeout" | "ban"; ms?: number }[],
  },

  /**
   * ส่งสถานะเครื่อง (CPU/RAM/อุณหภูมิ ฯลฯ แบบย่อ) เข้า Discord ผ่าน webhook เป็นระยะ
   * คล้าย Netdata แต่ไม่ลงรายละเอียด + แนบลิงก์นำทางไปเว็บที่ host อยู่
   */
  status: {
    // ต้องมี STATUS_WEBHOOK_URL ใน .env ด้วย ไม่งั้นถือว่าปิด (ไม่มีปลายทางส่ง)
    enabled: true,
    // Discord webhook URL — สร้างที่ Server Settings > Integrations > Webhooks
    webhookUrl: process.env.STATUS_WEBHOOK_URL || "",
    // ส่ง/อัปเดตทุกกี่มิลลิวินาที (แก้ข้อความเดิม ไม่สแปมห้อง)
    intervalMs: 10 * 60 * 1000, // 10 นาที
    // ลิงก์นำทางไปเว็บที่ host อยู่ — แก้ url ให้ตรงเครื่องคุณ (เว้น list ว่างได้ถ้าไม่ต้องการ)
    links: [
      { name: "Dashboard", url: "https://bot.admindawn.top/logs" },
      { name: "Netdata", url: "http://flick.tail538d1b.ts.net:19999" },
    ] as { name: string; url: string }[],
  },

  /**
   * ความเป็นส่วนตัว: ลบข้อมูลของคนที่ออกจากเซิร์ฟเวอร์อัตโนมัติ
   */
  privacy: {
    // ออกจากเซิร์ฟเวอร์แล้วลบบัตร/เตือน/XP/โทษไมค์แดง + ไฟล์รูปบัตรของคนนั้นทิ้ง
    purgeOnLeave: true,
    // แต่ถ้าออกเพราะ "ถูกแอดมินจัดการ" (แบน/เตะ/มีประวัติเตือน/กำลังโดนไมค์แดง)
    // ให้เก็บข้อมูลไว้เดิม ไม่ลบ — กันคนใกล้ครบเกณฑ์ชิงออกเพื่อรีเซ็ตประวัติ
    // และเก็บหลักฐานไว้เผื่อสืบย้อนหลัง (ลบเฉพาะคนที่ออกเองสะอาด ๆ)
    keepIfModerated: true,
    // ลบ ai_verdicts (ข้อความ+คำตัดสินของ mod) ด้วยไหม — ค่าเริ่มต้น false เพราะเป็น
    // ข้อมูลเทรนโมเดลรอบหน้า ตั้ง true ถ้าต้องการลบให้เกลี้ยงจริง ๆ (แลกกับคุณภาพเทรน)
    purgeAiVerdicts: false,
  },

  /**
   * ระบบ activity / XP — สะสมแต้มจากข้อความ + เวลาในห้องเสียง
   * ป้อนข้อมูลให้ "เลเวลบนบัตร" และ "หน้าโปรไฟล์" ต่อไป
   */
  activity: {
    enabled: true,
    // ข้อความ: ได้ XP เท่านี้ต่อ 1 ข้อความ (แต่ได้ไม่ถี่กว่า messageCooldownMs กัน spam farm)
    messageXp: 10,
    messageCooldownMs: 60_000, // 60 วินาที
    // ห้องเสียง: ได้ XP เท่านี้ต่อ 1 นาทีที่อยู่ในห้อง
    voiceXpPerMin: 5,
    // ไม่นับเวลา/XP ห้องเสียงถ้าปิดไมค์หรือปิดหูฟัง (กัน AFK farm) — true = นับทุกกรณี
    voiceCountWhileMuted: false,
  },
};
