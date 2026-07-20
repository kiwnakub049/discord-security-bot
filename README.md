# 🛡️ Discord Security Bot

บอทดูแลความปลอดภัยเซิร์ฟเวอร์ Discord — **anti-raid, anti-spam, auto-mod และ audit logging**
เขียนด้วย discord.js v14 + TypeScript

## ฟีเจอร์

- **Anti-raid** — ตรวจจับคนเข้าพร้อมกันเยอะผิดปกติ → kick/ban/lockdown อัตโนมัติ + เตือน account ที่อายุน้อย
- **Anti-spam** — จับการส่งข้อความถี่/ซ้ำ/mention เยอะ → ลบข้อความ + timeout ผู้ใช้
- **Auto-mod** — บล็อก invite เซิร์ฟเวอร์อื่น, ลิงก์ phishing, คำต้องห้าม
- **Logging** — ส่ง embed log ทุกเหตุการณ์สำคัญไปห้องที่กำหนด
- **Web dashboard** 🌐 — แสดง data-log บนเว็บแบบ real-time (live ผ่าน SSE), filter ตามระดับ + ค้นหา, เก็บ log ถาวรในไฟล์ `data/logs.jsonl`
- **ระบบ Login** 🔐 — session-based, mod แต่ละคนมี user/pass ของตัวเอง (รหัสผ่าน scrypt), cookie httpOnly/secure/sameSite
- **คำสั่ง** — `/lock`, `/unlock`, `/status` (เฉพาะคนมีสิทธิ์ Manage Server)

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
# แก้ .env ใส่ DISCORD_TOKEN, CLIENT_ID, GUILD_ID
```

### 3. เชิญบอทเข้าเซิร์ฟเวอร์
แท็บ **OAuth2 → URL Generator** เลือก scope `bot` + `applications.commands`
และ permission: Kick Members, Ban Members, Moderate Members, Manage Channels, Manage Messages, View Channels, Send Messages
แล้วเปิดลิงก์ที่ได้เพื่อเชิญบอท

### 4. ลงทะเบียนคำสั่ง + รัน
```bash
npm install
npm run deploy   # ลงทะเบียน slash commands (รันครั้งเดียว / เมื่อเพิ่มคำสั่งใหม่)
npm run dev      # รันแบบ auto-reload ตอนพัฒนา
# หรือ
npm start        # รันปกติ
```

## ปรับแต่ง

แก้ค่าทั้งหมดได้ที่ `src/config.ts` — threshold ทุกตัวมีคอมเมนต์อธิบาย
อย่าลืมใส่ `logChannelId` เพื่อให้ log ขึ้นในห้อง Discord (ไม่งั้น log ลง console อย่างเดียว)

## 🌐 Web Dashboard

พอรันบอท (`npm run dev`) เว็บจะเปิดที่ **http://localhost:3000** (bind `127.0.0.1` เท่านั้น)
แสดง log ทุกเหตุการณ์แบบ real-time (เด้งขึ้นทันทีที่เกิดเหตุ ไม่ต้องรีเฟรช) มี:
- การ์ดสรุปจำนวน Info / Warn / Alert
- ปุ่ม filter ตามระดับ + ช่องค้นหา
- log ถูกเก็บถาวรในไฟล์ `data/logs.jsonl` (รอด restart)

ปรับ port / host / cookieSecure ได้ที่ `config.web` ใน `src/config.ts`

### 🔐 Login & บัญชี mod

dashboard ต้อง login ก่อนถึงดูได้ (session-based) ต้องตั้ง `SESSION_SECRET` ใน `.env` ก่อน:
```bash
openssl rand -hex 32        # เอาค่าไปใส่ SESSION_SECRET ใน .env
```
จัดการบัญชี mod (แต่ละคนมี user/pass ของตัวเอง):
```bash
npm run user:add <username>      # เพิ่ม (ถามรหัสผ่านแบบไม่โชว์)
npm run user:remove <username>   # ตัดสิทธิ์ — session ที่ค้างอยู่ใช้ไม่ได้ทันที
```
รหัสผ่านเก็บเป็น scrypt hash ใน `data/users.json` (ไม่เก็บ plaintext, อยู่ใน .gitignore)

## โครงสร้างโปรเจกต์
```
src/
├── index.ts              # entry point + โหลด event อัตโนมัติ
├── config.ts             # ⚙️ ค่าตั้งทั้งหมด ปรับที่นี่
├── deploy-commands.ts    # ลงทะเบียน slash commands
├── events/               # ตัวรับ event จาก Discord
│   ├── ready.ts
│   ├── guildMemberAdd.ts   # → anti-raid
│   ├── messageCreate.ts    # → auto-mod + anti-spam
│   └── interactionCreate.ts # → slash commands
├── modules/              # ตรรกะหลักของแต่ละระบบ
│   ├── antiRaid.ts
│   ├── antiSpam.ts
│   └── autoMod.ts
├── commands/             # slash commands
├── auth/
│   ├── users.ts          # บัญชี mod + scrypt hash (data/users.json)
│   └── session.ts        # session ฝั่ง server + เซ็น cookie ด้วย SESSION_SECRET
├── scripts/              # CLI: userAdd / userRemove (npm run user:add|remove)
├── store/
│   └── logStore.ts       # เก็บ log (in-memory + ไฟล์ JSONL) + แจ้ง event ให้เว็บ
├── web/                  # 🌐 dashboard
│   ├── server.ts         # Express: /login /logout + auth gate + API + SSE
│   └── public/           # index.html (dashboard) + login.html
└── utils/                # logger, exempt check
```

## เอาขึ้น VPS / production

ดู **[DEPLOY.md](DEPLOY.md)** — มีคู่มือครบ: สเปก VPS, ติดตั้ง Node, รันเป็น systemd service,
ตั้ง firewall, และเปิด dashboard อย่างปลอดภัย (SSH tunnel หรือ Caddy + HTTPS)
ไฟล์ตัวอย่างอยู่ในโฟลเดอร์ `deploy/`

## ไอเดียต่อยอด
- ระบบ warning points + auto-escalation (เตือน → mute → ban)
- เก็บ log ลงฐานข้อมูล (SQLite/Postgres) แทน in-memory
- Verification gate (ปุ่มยืนยันตัวตน/captcha ก่อนเข้าเซิร์ฟเวอร์)
- Dashboard เว็บสำหรับปรับ config แทนแก้ไฟล์
