# 🚀 Deploy บน VPS (step-by-step)

คู่มือเอาบอทขึ้น production แบบปลอดภัย — เขียนตามสเปกจริง: **Ubuntu 24.04, 2 Core / 2GB RAM**
(เหลือเฟือมากสำหรับบอทตัวนี้)

> **หลักการออกแบบ:** การล็อกอินเข้า dashboard อยู่ใน *ตัวบอทเอง* (session-based) และบอท bind ที่
> `127.0.0.1` เท่านั้น ส่วน "วิธีเปิด dashboard ออกเน็ต" (Caddy วันนี้ / Cloudflare Tunnel วันหน้า)
> เป็นแค่ตัว **ส่งต่อ (reverse proxy)** เข้ามาที่ `127.0.0.1:3000` — สลับวิธีได้โดยไม่ต้องแก้โค้ดบอทเลย
> (ดูหัวข้อ [เปิด dashboard ออกเน็ต](#5-เปิด-dashboard-ออกเน็ต-เลือกวิธีได้))

---

## 1. สร้าง user ธรรมดา (อย่ารันด้วย root)

ล็อกอินเข้า VPS ครั้งแรกด้วย root (ตามอีเมลที่ CloudVPS ส่งมา) แล้วสร้าง user สำหรับใช้งาน:

```bash
adduser deploy                 # ตั้งรหัสผ่าน + ข้อมูล (เว้นว่างได้)
usermod -aG sudo deploy        # ให้สิทธิ์ sudo
```

จากนั้นสร้าง **system user** แยกไว้รันบอทโดยเฉพาะ (ไม่มี shell, ปลอดภัยกว่า):
```bash
adduser --system --group botuser
```

## 2. ตั้ง SSH key + ปิด password login

**บนเครื่องคุณเอง** (ไม่ใช่บน VPS) สร้าง key ถ้ายังไม่มี แล้วก็อปขึ้น VPS:
```bash
ssh-keygen -t ed25519            # ถ้ายังไม่มี key
ssh-copy-id deploy@<ip-ของ-vps>  # ก็อป public key ขึ้นไป
```

ทดสอบว่า `ssh deploy@<ip>` เข้าได้โดยไม่ต้องใส่รหัส แล้วค่อย **ปิด password login**
บน VPS แก้ `/etc/ssh/sshd_config`:
```bash
sudo nano /etc/ssh/sshd_config
```
ตั้งค่าเหล่านี้ (เอา # ออกถ้ามี):
```
PasswordAuthentication no
PermitRootLogin no
```
แล้วรีโหลด + ติดตั้ง fail2ban กัน brute-force:
```bash
sudo systemctl restart ssh
sudo apt update && sudo apt install -y fail2ban
```
> ⚠️ อย่าเพิ่งปิด terminal เดิม — เปิด terminal ใหม่ลองล็อกอินให้ผ่านก่อน เผื่อพลาดจะได้แก้ทัน

## 3. ตั้ง Firewall (ufw) — เปิดเฉพาะที่จำเป็น

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp     # สำหรับ Caddy (HTTPS) — ข้ามได้ถ้าจะใช้ Cloudflare Tunnel/SSH tunnel
sudo ufw enable
sudo ufw status
```
> 🚫 **ห้ามเปิด port 3000** — บอท bind อยู่ที่ `127.0.0.1` เข้าจากนอกตรง ๆ ไม่ได้อยู่แล้ว (ตั้งใจให้เป็นแบบนี้)
> traffic จากภายนอกต้องผ่าน reverse proxy (80/443) ที่ตรวจ HTTPS + ส่งต่อเข้ามาเท่านั้น

## 4. ลง Node 22 + ดึงโค้ด + ตั้งค่า

```bash
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v    # ควรขึ้น v22.x

# ดึงโค้ดมาไว้ในโฮมของ botuser
sudo -u botuser -s
cd /home/botuser
git clone <repo-ของคุณ> discord-security-bot   # หรือ scp ไฟล์ขึ้นมา
cd discord-security-bot
npm install

# ตั้งค่า .env
cp .env.example .env
nano .env
```
ใน `.env` ใส่:
- `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (จาก Discord Developer Portal)
- `SESSION_SECRET` — สร้างด้วยคำสั่งนี้แล้ววางค่า:
  ```bash
  openssl rand -hex 32
  ```

แล้วล็อกไฟล์ + ลงทะเบียน slash commands:
```bash
chmod 600 .env
npm run deploy
exit            # ออกจาก shell ของ botuser
```

## 5. รันเป็น systemd service

```bash
sudo cp /home/botuser/discord-security-bot/deploy/discord-bot.service /etc/systemd/system/
sudo nano /etc/systemd/system/discord-bot.service   # เช็ค path/User ให้ตรง (which npm)
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot
journalctl -u discord-bot -f                         # ดู log สด ๆ (Ctrl+C เพื่อออก)
```

## 6. สร้างบัญชี mod (login เข้า dashboard)

mod แต่ละคนมี user/pass ของตัวเอง:
```bash
sudo -u botuser -s
cd /home/botuser/discord-security-bot
npm run user:add alice      # จะถามรหัสผ่าน (พิมพ์แบบไม่โชว์ + ยืนยัน)
npm run user:add bob
exit
```
ตัดสิทธิ์ภายหลัง (session ที่ค้างอยู่ของคนนั้นจะใช้ไม่ได้ทันที):
```bash
sudo -u botuser -s -c 'cd /home/botuser/discord-security-bot && npm run user:remove bob'
```
> รหัสผ่านเก็บเป็น scrypt hash ในไฟล์ `data/users.json` (อยู่ใน .gitignore ไม่หลุดขึ้น git)

## 7. เปิด dashboard ออกเน็ต (เลือกวิธีได้)

ส่วนนี้ **แยกขาดจากตัวบอท** — เปลี่ยนวิธีเมื่อไหร่ก็ได้โดยไม่ต้องแก้โค้ด เพราะ login อยู่ในแอปแล้ว

### วิธี A — SSH tunnel (ง่ายสุด ไม่ต้องมีโดเมน เหมาะตอนเริ่ม/ดูเองคนเดียว)
บนเครื่องคุณ:
```bash
ssh -L 3000:localhost:3000 deploy@<ip-ของ-vps>
```
แล้วเปิด http://localhost:3000 — ไม่เปิดอะไรออกเน็ตเลย ปลอดภัยสุด
(ตอนนี้ `cookieSecure` เป็น `false` อยู่แล้ว ใช้กับ http ได้)

### วิธี B — Caddy + โดเมน + HTTPS (ให้ทีม mod เข้าผ่านเบราว์เซอร์ได้)
1. ชี้ DNS **A record** ของโดเมนมาที่ IP ของ VPS (เช่น `logs.example.com`)
2. ติดตั้ง Caddy: https://caddyserver.com/docs/install
3. แก้โดเมนใน `deploy/Caddyfile` แล้ว:
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy     # Caddy จะขอใบ cert ฟรีจาก Let's Encrypt ให้เอง
   ```
4. **เปิด secure cookie** (เพราะมี HTTPS แล้ว): แก้ `src/config.ts` → `web.cookieSecure: true`
   แล้ว `sudo systemctl restart discord-bot`

> Caddy ทำแค่ HTTPS + ส่งต่อ ไม่ต้องตั้ง basic auth เพราะบอทมีระบบ login เองแล้ว

## 8. ✅ Checklist ก่อน go-live

- [ ] ล็อกอิน SSH ด้วย key ได้ และ **ปิด password login** + `PermitRootLogin no` แล้ว
- [ ] `fail2ban` ทำงาน (`sudo systemctl status fail2ban`)
- [ ] `ufw status` เปิดแค่ SSH + 80/443 — **ไม่มี 3000**
- [ ] `.env` มี `SESSION_SECRET` ที่สุ่มจริง และ `chmod 600` แล้ว
- [ ] ถ้าใช้ HTTPS (วิธี B) → ตั้ง `cookieSecure: true` แล้ว
- [ ] สร้างบัญชี mod อย่างน้อย 1 คน และทดสอบ login + logout ได้
- [ ] ลองเข้า `/api/logs` โดยไม่ login → ต้องโดนปฏิเสธ (401)
- [ ] `systemctl enable` แล้ว (บอทกลับมาเองหลังรีบูต)
- [ ] อัปเดตระบบ: `sudo apt update && sudo apt upgrade -y` และตั้ง `unattended-upgrades`

## อัปเดตบอทภายหลัง
```bash
sudo -u botuser -s -c 'cd /home/botuser/discord-security-bot && git pull && npm install'
sudo systemctl restart discord-bot
```

---

## 🍓 หมายเหตุสำหรับย้ายไป Raspberry Pi 5 (อนาคต)

โค้ดบอทไม่ต้องแก้อะไรเลย — ทุกอย่างเหมือนเดิม ต่างกันแค่ "ตัวส่งต่อ":

- **Node บน Pi:** ใช้ NodeSource (ARM64) ได้เหมือนกัน หรือใช้ `nvm` Raspberry Pi OS (64-bit) แนะนำ
- **systemd / ufw / SSH:** ทำเหมือน VPS ทุกขั้น
- **เปิดออกเน็ตด้วย Cloudflare Tunnel** (เหมาะกับ Pi ที่อยู่บ้าน ไม่มี public IP / IP เปลี่ยน):
  ```bash
  # ติดตั้ง cloudflared แล้ว
  cloudflared tunnel login
  cloudflared tunnel create security-dashboard
  # ใน config ของ tunnel ชี้ ingress มาที่ service: http://127.0.0.1:3000
  cloudflared tunnel route dns security-dashboard logs.example.com
  ```
  - **ไม่ต้องเปิด port ใด ๆ บน firewall เลย** (Cloudflare เชื่อมออกจาก Pi เอง) — ปลอดภัยมากสำหรับเครือข่ายบ้าน
  - **ปิด ufw 80/443 ได้** เพราะไม่ต้องรับ traffic เข้าตรง ๆ อีกต่อไป
  - บอทยัง bind `127.0.0.1:3000` เหมือนเดิม / login session เหมือนเดิม → **ไม่ต้องแตะโค้ด**
  - Cloudflare ให้ HTTPS อยู่แล้ว → คง `cookieSecure: true`
- **เก็บข้อมูลถาวร:** ไฟล์ `data/` (users.json + logs.jsonl) ก็อปย้ายเครื่องได้ตรง ๆ — ไม่มี dependency กับ OS
- **SD card:** ถ้ากังวลเรื่องการเขียนบ่อย พิจารณาบูตจาก SSD/USB หรือย้าย `data/` ไปไว้บน storage ที่ทนกว่า
