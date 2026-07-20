# 🛡️ Discord Security Bot

บอทดูแลเซิร์ฟเวอร์ Discord ครบวงจร — **anti-raid, anti-spam, auto-mod, ระบบเตือน,
บัตรสมาชิก, เลเวล/XP และ web dashboard แบบ real-time**
เขียนด้วย discord.js v14 + TypeScript เก็บข้อมูลทั้งหมดใน SQLite (`data/bot.db`)

## ฟีเจอร์

### 🔒 ความปลอดภัย
- **Anti-raid** — ตรวจจับคนเข้าพร้อมกันเยอะผิดปกติ → kick/ban เฉพาะ account ใหม่ หรือ lockdown ทั้งเซิร์ฟ
- **Anti-spam** — จับส่งข้อความถี่/ซ้ำ/mention เยอะ → ลบข้อความ + timeout + DM แจ้งผู้ใช้
- **Auto-mod** — บล็อก invite เซิร์ฟเวอร์อื่น, ลิงก์ phishing, คำต้องห้าม (ตั้งได้จากหน้า Settings)
- **ระบบเตือน (warnings)** — สะสมครบแล้วลงโทษอัตโนมัติ: 3 ครั้ง timeout 1 ชม. → 5 ครั้ง 1 วัน → 7 ครั้ง ban
- **ล็อกห้องเสียง** — `/lockvoice` ล็อกห้องพร้อมเก็บ snapshot สิทธิ์เดิมไว้คืนตอนปลดล็อก

### 🪪 บัตรสมาชิก + เลเวล
- สร้างบัตรประจำตัวเป็นรูป PNG จากเทมเพลต (avatar, หมายเลขสมาชิก, วันเข้า, สถานะ, bias, เลเวล)
- ลงทะเบียนผ่าน `/register` หรือปุ่มกด (`/setup-idcard` วาง panel ให้กดสร้างเอง)
- คนมีบัตรได้ role อัตโนมัติ (ตั้ง role ได้ในหน้า Settings)
- **ระบบ XP** — ได้จากข้อความ (มี cooldown กัน farm) + เวลาในห้องเสียง (ไม่นับตอนปิดไมค์/หูฟัง)
  ดูด้วย `/rank`, `/leaderboard` หรือหน้า "จัดอันดับ" บนเว็บ

### 🌐 Web dashboard (ต้อง login)
- **ภาพรวม** — สถิติเหตุการณ์ 24 ชม., alert ล่าสุด, ใครอยู่ห้องเสียง, ปุ่มล็อก/ปลดล็อกเซิร์ฟ
- **Log real-time** — เด้งทันทีผ่าน SSE, กรองตามหมวด/ระดับ/เวลา, ค้นหา, export CSV, แจ้งเตือนเสียง+desktop
- **บัตรสมาชิก** — ดูบัตรทุกคน + สถานะเสียงสด + ปุ่มสั่ง เตือน/timeout/kick/ban จากหน้าเว็บ
- **จัดอันดับ** — leaderboard XP / เวลาห้องเสียง พร้อม progress bar เลเวล
- **ตั้งค่า** — ปรับ threshold ทุกระบบสด ๆ ไม่ต้อง restart + จัดการบัญชี mod

## เริ่มใช้งาน

### 1. สร้างบอทใน Discord Developer Portal
1. ไปที่ https://discord.com/developers/applications → **New Application**
2. แท็บ **Bot** → **Reset Token** → คัดลอก token
3. ในแท็บ **Bot** เปิด 2 อย่างนี้ (สำคัญมาก ไม่งั้นบอทจะไม่เห็นข้อความ/สมาชิก):
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**

### 2. ตั้งค่า
```bash
cp .env.example .env
# แก้ .env ใส่ DISCORD_TOKEN, CLIENT_ID, GUILD_ID และ SESSION_SECRET (มีคำอธิบายในไฟล์)
```

### 3. เชิญบอทเข้าเซิร์ฟเวอร์
แท็บ **OAuth2 → URL Generator** เลือก scope `bot` + `applications.commands` และ permission:
Kick Members, Ban Members, Moderate Members, Manage Channels, **Manage Roles** (สำหรับ role คนมีบัตร),
Manage Messages, View Channels, Send Messages, View Audit Log
แล้วเปิดลิงก์ที่ได้เพื่อเชิญบอท

### 4. ลงทะเบียนคำสั่ง + รัน
```bash
npm install
npm run deploy   # ลงทะเบียน slash commands (รันครั้งเดียว / เมื่อเพิ่มคำสั่งใหม่)
npm run dev      # รันแบบ auto-reload ตอนพัฒนา
# หรือ
npm start        # รันปกติ
```

> เคยใช้เวอร์ชันเก่าที่เก็บข้อมูลเป็นไฟล์ JSON (`data/*.json`)?
> รัน `npm run db:migrate` ครั้งเดียวเพื่อย้ายข้อมูลเข้า SQLite

## คำสั่งทั้งหมด

| คำสั่ง | สิทธิ์ | ทำอะไร |
|---|---|---|
| `/idcard [member]` | ทุกคน | ดูบัตรตัวเอง/คนอื่น |
| `/register [status] [bias]` | ทุกคน | ลงทะเบียนรับบัตร |
| `/setbias`, `/setstatus` | ทุกคน | แก้ข้อมูลบนบัตร |
| `/rank [member]` | ทุกคน | ดูเลเวล/XP/สถิติ |
| `/leaderboard [by]` | ทุกคน | อันดับ XP หรือเวลาห้องเสียง |
| `/warn`, `/warnings` | Moderate Members | เตือน / ดูประวัติเตือน |
| `/clearwarnings` | Manage Server | ล้างเตือน |
| `/lock`, `/unlock`, `/status` | Manage Server | ล็อกทุกห้องแชต / ปลด / ดูสถานะระบบ |
| `/lockvoice`, `/unlockvoice` | Manage Channels | ล็อก/ปลดล็อกห้องเสียง |
| `/setup-idcard`, `/issue`, `/sync-cardroles` | Administrator | วาง panel สร้างบัตร / ออกบัตรให้ / ซิงค์ role |

## ปรับแต่ง

ค่าเริ่มต้นทั้งหมดอยู่ที่ `src/config.ts` (ทุก threshold มีคอมเมนต์อธิบาย)
ค่าส่วนใหญ่แก้สด ๆ ได้จากหน้า **Settings** บนเว็บ — รวมถึงห้อง log, คำต้องห้าม,
role/user ที่ยกเว้น, role คนมีบัตร — บันทึกแล้วมีผลทันที ไม่ต้อง restart (เก็บทับใน DB)

## 🌐 Web dashboard

พอรันบอท เว็บจะเปิดที่ **http://localhost:3000** (bind `127.0.0.1` เท่านั้น —
เอาขึ้น VPS ให้ดู DEPLOY.md เรื่อง reverse proxy/SSH tunnel)

### 🔐 Login & บัญชี mod

dashboard ต้อง login ก่อนถึงดูได้ (session ฝั่ง server + cookie httpOnly/secure/sameSite)
ต้องตั้ง `SESSION_SECRET` ใน `.env` ก่อน ไม่งั้นเว็บจะไม่เปิดเลย:
```bash
openssl rand -hex 32        # เอาค่าไปใส่ SESSION_SECRET ใน .env
```
เพิ่มบัญชี mod คนแรกผ่าน CLI (คนถัดไปเพิ่มจากหน้า Settings บนเว็บได้เลย):
```bash
npm run user:add <username>      # เพิ่ม (ถามรหัสผ่านแบบไม่โชว์)
npm run user:remove <username>   # ตัดสิทธิ์ — session ที่ค้างอยู่ใช้ไม่ได้ทันที
```
รหัสผ่านเก็บเป็น scrypt hash ในตาราง `users` ของ `data/bot.db` (ไม่เก็บ plaintext)
มีระบบกัน brute-force: ลองผิด 5 ครั้ง ล็อก IP 15 นาที

## โครงสร้างโปรเจกต์
```
src/
├── index.ts              # entry point + โหลด event อัตโนมัติ
├── config.ts             # ⚙️ ค่าเริ่มต้นทั้งหมด (ส่วนใหญ่แก้สดได้จากหน้า Settings)
├── deploy-commands.ts    # ลงทะเบียน slash commands
├── events/               # ตัวรับ event จาก Discord (join/message/voice/audit/...)
├── modules/              # ตรรกะหลัก: antiRaid, antiSpam, autoMod, warnings,
│                         #   voiceLock, cardRole, serverLog, dmNotice, voiceActivity
├── commands/             # slash commands ทั้งหมด (รวมไว้ใน index.ts)
├── idcard/               # สร้างรูปบัตร (canvas + เทมเพลต) + cache + ปุ่ม/modal
├── store/                # SQLite: db.ts (ตาราง), logStore, settingsStore,
│                         #   activityStore (XP), voiceState
├── auth/                 # บัญชี mod (scrypt) + session (HMAC cookie)
├── web/                  # 🌐 dashboard: server.ts (Express + auth + API + SSE)
│   └── public/           #   index.html (SPA) + login.html
├── scripts/              # CLI: user:add / user:remove / db:migrate / avatar:set
└── utils/                # logger (log กลาง → DB + SSE + ห้อง Discord), exempt
test/                     # node test runner — npm test
deploy/                   # ตัวอย่าง systemd service + Caddyfile
```

## เอาขึ้น VPS / production

ดู **[DEPLOY.md](DEPLOY.md)** — มีคู่มือครบ: สเปก VPS, ติดตั้ง Node, รันเป็น systemd service,
ตั้ง firewall, และเปิด dashboard อย่างปลอดภัย (SSH tunnel หรือ Caddy + HTTPS)

## ไอเดียต่อยอด
- Verification gate (ปุ่มยืนยันตัวตน/captcha ก่อนเข้าเซิร์ฟเวอร์)
- Lockdown ให้ครอบคลุมห้อง Announcement/Forum/Thread (ตอนนี้ล็อกเฉพาะห้องแชตปกติ)
- Log retention — ลบ log เก่าอัตโนมัติกัน DB โต
- เทสเพิ่มสำหรับ autoMod / antiSpam / warnings
