# Security Runbook — bot.admindawn.top / Pi "Flick"

อัปเดตล่าสุด: 3 ก.ย. 2026 (หลังทำแผน hardening กัน botnet/XWorm)

## สิ่งที่ทำไปแล้ว (ระบบป้องกันปัจจุบัน)

| ชั้น | สิ่งที่มี |
|---|---|
| Edge | Cloudflare Tunnel (ขาออกล้วน ไม่มีพอร์ตเปิดเข้าบ้าน) · cloudflared อัปเดตผ่าน apt อัตโนมัติ |
| Firewall | nftables `/etc/nftables.conf` — **drop ทุกขาเข้า** ทั้ง v4/v6 ยกเว้น: lo, tailscale0, established, SSH+mDNS จาก LAN เท่านั้น → ปิดช่อง IPv6 สาธารณะสนิท |
| บริการ | ปิดถาวร: rpcbind (mask), Samba (smbd/nmbd/winbind), Bluetooth, ModemManager, desktop (lightdm→multi-user) · avahi เหลือ LAN v4 |
| Patching | unattended-upgrades: Debian-Security + RPi + cloudflared + Tailscale · reboot อัตโนมัติ 04:30 ถ้าจำเป็น |
| แอป | rate limit: `/login` 20/15นาที · `/api` 240/นาที (เว้น SSE) · export 10/5นาที · lockout 5/15นาที · แจ้งเตือนเหตุการณ์เข้า Discord webhook (dedupe 1/นาที) |
| Session | TTL 7 วัน (sliding) · cookie `__Host-sid` (Secure+Path=/+ห้าม Domain โดยเบราว์เซอร์บังคับ) |
| Discord | automod ลบไฟล์แนบอันตราย (.exe .scr .lnk .ps1 ฯลฯ รวม double-extension) + เตือนลิงก์ย่อ/paste |
| SSH | AllowUsers flick, key 2 ดอก, Tailscale SSH เปิดเป็นทางสำรอง (ดู "งานค้าง" เรื่องปิดรหัสผ่าน) |

## งานที่ต้องทำในหน้า Cloudflare (dashboard.cloudflare.com — ทำมือ ~15 นาที)

1. **Access (สำคัญสุด — ตอนนี้ยังไม่เปิด! หน้า login โดนสแกนจากเน็ตได้):**
   Zero Trust → Access → Applications → Add → Self-hosted
   - Application domain: `bot.admindawn.top`
   - Policy: Allow → Include → Emails → ใส่อีเมลตัวเอง (+mod ที่ต้องเข้าเว็บจากเน็ตนอก)
   - Login method: One-time PIN (ฟรี)
   - ผล: คนนอกลิสต์มองไม่เห็นแม้แต่หน้า login · ทาง Tailscale ไม่กระทบ
2. **Rate limiting rule** (Security → WAF → Rate limiting rules — ฟรี 1 rule):
   expression `(http.request.uri.path eq "/login" and http.request.method eq "POST")` → 5 req/10s ต่อ IP → Block
3. **Bot Fight Mode**: Security → Bots → เปิด
4. **Managed WAF**: Security → WAF → Managed rules → deploy "Cloudflare Free Managed Ruleset"
5. **HSTS**: SSL/TLS → Edge Certificates → Always Use HTTPS เปิด + HSTS max-age 6 เดือน (ไม่ต้อง preload/subdomains)
6. **2FA บัญชี Cloudflare** (คุมทั้ง tunnel+Access = คุมทางเข้าทั้งหมด)

## ตอนโดน DDoS (playbook)

1. Cloudflare → Security → Settings → Security Level = **"Under Attack"** (เปิดชั่วคราว — SSE บนเว็บจะสะดุดบ้าง ยอมรับได้)
2. ดู Security → Events ว่าโดนอะไร/จากไหน
3. ถ้าจำเป็น: สร้าง WAF custom rule block ประเทศ/ASN ที่ยิงมา
4. เครื่องเราไม่โดนตรง ๆ อยู่แล้ว (ไม่มีพอร์ตขาเข้า) — ที่ต้องรอดคือ CF edge ซึ่งรอดเสมอ

## เช็คลิสต์เครื่องแอดมิน (q-pc) — จุดที่ XWorm ลงจริง

- [ ] Windows Defender เปิดครบ (real-time + cloud) **ไม่มี exclusion**
- [ ] ไม่ลงของ crack / "free nitro" / cheat — ช่องทางหลักของ XWorm
- [ ] **ไม่รันไฟล์แนบจาก Discord DM เด็ดขาด** แม้จากคนรู้จัก (บัญชีเพื่อนโดนยึดได้)
- [ ] Discord: เปิด **2FA** + Server Settings → Safety Setup → **บังคับ 2FA สำหรับ mod**
- [ ] Tailscale account เปิด 2FA (เท่ากับกุญแจ SSH เข้า Pi)
- [ ] แยก browser profile เฉพาะงานแอดมิน (dashboard/Cloudflare/Discord) — stealer ขโมย cookie ได้เฉพาะ profile ที่ติด

## ตรวจสุขภาพรายสัปดาห์ (10 นาที)

```bash
sudo nft list chain inet hardening input | grep counter   # ขาเข้าที่โดน drop (ควรเพิ่มช้า ๆ)
journalctl -u ssh --since -7d | grep -icE "fail|invalid"  # ควร ~0
apt list --upgradable 2>/dev/null | head                  # ควรว่าง (auto-update ทำงาน)
ss -tulnp                                                  # เทียบ baseline ด้านล่าง
```
- Cloudflare → Security → Events + Analytics (ยอด block/ทราฟฟิกแปลก)
- ช่องแจ้งเตือน Discord: มี alert ค้างไหม / automod จับผิดตัวไหม

**Baseline listener ที่ถูกต้อง (3 ก.ย. 2026):** SSH :22 (คุมด้วย firewall = LAN+tailnet เท่านั้น) · tailnet-only: :80, :19999 (netdata) · loopback: 3000, 8081, 631 · UDP: 5353 (LAN), 41641 (tailscale) — **เห็นอย่างอื่น = ผิดปกติ สอบสวนทันที**

## งานค้าง / ทางเลือกเพิ่มเติม

- **ปิดรหัสผ่าน SSH**: ไฟล์เตรียมแล้ว — ทดสอบ key จากทุกเครื่องก่อน แล้วค่อยติดตั้ง `10-hardening.conf` (ดูขั้นตอนในแชต/แผน)
- **sudo ถามรหัส**: ตัดสินใจแล้วว่าทำ — เป็นขั้นสุดท้ายหลัง verify ทุกอย่าง (`visudo -f /etc/sudoers.d/010_pi-nopasswd` → `flick ALL=(ALL) ALL`)
- **Tailnet เป็น HTTPS** (ตอนนี้ http = เก็บ session cookie ไม่ได้เพราะ Secure flag): เปิด HTTPS certificates ใน Tailscale admin console (DNS → HTTPS Certificates → Enable) แล้วรัน `sudo tailscale serve --https=443 --bg http://127.0.0.1:3000`
- **Backup ออกนอกเครื่อง** (ยังอยู่บน SD ใบเดียว): `rclone` → Google Drive + restore drill
- **Heartbeat สถิติความปลอดภัย** ใน status embed รายวัน (มี `securityCounts()` เตรียมไว้แล้วใน `securityAlerts.ts`)

## Rollback ทุกอย่าง

| อะไร | วิธีถอย |
|---|---|
| Firewall | `sudo nft destroy table inet hardening` + `systemctl disable nftables` |
| SSH | ลบ `/etc/ssh/sshd_config.d/10-hardening.conf` + `systemctl restart ssh` (มี Tailscale SSH สำรองเสมอ) |
| บริการที่ปิด | `sudo systemctl unmask <svc>; sudo systemctl enable --now <svc>` (desktop: `set-default graphical.target`) |
| avahi/cloudflared config | ไฟล์ `.bak-20260903` วางคู่กันทุกไฟล์ |
| โค้ดแอป | `git revert` ใน repo |
| sudoers | `visudo -f` แก้กลับ |
