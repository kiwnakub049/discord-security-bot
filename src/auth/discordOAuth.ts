import { randomBytes } from "node:crypto";

/**
 * Login ด้วย Discord (OAuth2 authorization code)
 *
 * ขอแค่ scope "identify" = รู้ว่าเป็นใคร (ID + ชื่อ) เท่านั้น ไม่ขออ่านเซิร์ฟ/อีเมล/อะไรอื่น
 * สิทธิ์จริงดูจากยศในเซิร์ฟผ่านบอทอีกทีหนึ่ง (ดู access.ts) — token ของ Discord
 * ใช้ครั้งเดียวตอนถามว่าเป็นใคร แล้วทิ้ง ไม่เก็บลง DB
 *
 * ต้องตั้งใน .env:
 *   CLIENT_ID              — Application ID เดียวกับที่ใช้ deploy คำสั่ง
 *   DISCORD_CLIENT_SECRET  — Developer Portal → OAuth2 → Client Secret
 *   DASHBOARD_URL          — ที่อยู่เว็บที่คนเปิดจริง เช่น https://bot.example.com
 * และเพิ่ม Redirect ใน Developer Portal → OAuth2 → Redirects ให้ตรงกับ redirectUri()
 */

const API = "https://discord.com/api/v10";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** ค่าที่ต้องใช้ — null = ยังตั้งไม่ครบ (หน้า login จะบอกว่าต้องตั้งอะไร) */
export function oauthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
  const clientId = env.CLIENT_ID?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  const base = env.DASHBOARD_URL?.trim().replace(/\/+$/, "");
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/auth/discord/callback` };
}

/** ค่าสุ่มกัน CSRF ของ OAuth — เก็บใน cookie แล้วต้องตรงกับที่ Discord ส่งกลับมา */
export function newState(): string {
  return randomBytes(24).toString("hex");
}

export function authorizeUrl(cfg: OAuthConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    // เคยกดอนุญาตแล้ว Discord จะข้ามหน้าถามให้เอง ไม่ต้องกดซ้ำทุกครั้ง
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

export interface DiscordIdentity {
  id: string;
  username: string;
}

/**
 * แลก code เป็นตัวตนผู้ใช้ — โยน error ถ้าแลกไม่ผ่าน (code หมดอายุ/ถูกใช้ไปแล้ว/secret ผิด)
 * fetchImpl แยกออกมาให้เทสใส่ของปลอมได้ ไม่ต้องยิง Discord จริง
 */
export async function identify(
  cfg: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordIdentity> {
  const tokenRes = await fetchImpl(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`แลก code ไม่ผ่าน (${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error("Discord ไม่ส่ง access token มา");

  const meRes = await fetchImpl(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) throw new Error(`อ่านข้อมูลผู้ใช้ไม่ผ่าน (${meRes.status})`);
  const me = (await meRes.json()) as { id?: string; username?: string };
  if (!me.id || !/^\d+$/.test(me.id)) throw new Error("ข้อมูลผู้ใช้จาก Discord ไม่ถูกต้อง");
  return { id: me.id, username: me.username ?? me.id };
}
