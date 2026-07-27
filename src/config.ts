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
  },

  /**
   * AI mod: ส่งข้อความให้โมเดล toxic classifier ภาษาไทย (toxic-serve บน Pi)
   * ช่วยตัดสินต่อจาก auto-mod — โซน "auto" ลงโทษเอง, โซน "review" ขึ้น dashboard
   * threshold ของโซนอ่านจาก model_card.json ฝั่ง service ไม่ต้องตั้งที่นี่
   */
  aiMod: {
    enabled: true,
    // pi_serve.py ฟังแค่ 127.0.0.1 — บอทต้องรันบนเครื่องเดียวกับ service
    url: "http://127.0.0.1:8081/classify",
    // เกินนี้ถือว่า service ไม่ตอบ => ปล่อยข้อความผ่าน (fail-open)
    timeoutMs: 3_000,
    // ลบข้อความทันทีเมื่อเข้าโซน auto
    deleteOnAuto: true,
    // ข้อความสั้นกว่านี้ (ตัวอักษร) ไม่ส่งตรวจ
    minLength: 2,
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

  /**
   * Web dashboard: แสดง data-log บนเว็บแบบ real-time
   */
  web: {
    enabled: true,
    port: 3000,
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
    // เมื่อจำนวนเตือนถึง count ให้ทำ action: timeout (ใส่ ms) หรือ ban
    escalation: [
      { count: 3, action: "timeout", ms: 60 * 60 * 1000 }, // 3 ครั้ง: timeout 1 ชม.
      { count: 5, action: "timeout", ms: 24 * 60 * 60 * 1000 }, // 5 ครั้ง: timeout 1 วัน
      { count: 7, action: "ban" }, // 7 ครั้ง: แบน
    ] as { count: number; action: "timeout" | "ban"; ms?: number }[],
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
