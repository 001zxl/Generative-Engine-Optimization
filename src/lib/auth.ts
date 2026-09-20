/**
 * 运营台鉴权（单操作员口令模式）。
 *
 * 设计取舍：
 *  - **不做用户表**。当前是单工作区、单操作员场景，引入用户/角色表只会增加
 *    未经验证的复杂度。需要多用户时再换，接口保持不变。
 *  - **用 Web Crypto 而不是 node:crypto**。middleware 默认跑在 Edge 运行时，
 *    node:crypto 不可用；Web Crypto 两边都能跑，从而保证「校验逻辑只有一份」。
 *  - **失败关闭（fail closed）**。缺少 AUTH_SECRET 或 CONSOLE_PASSWORD 时
 *    一律拒绝访问，而不是放行。配置缺失绝不能等于没有门。
 *  - 会话是 HMAC 签名的无状态 cookie，服务端不存 session —— 单机部署下最简单，
 *    也避免了「重启丢登录态」。
 */

const COOKIE_NAME = "geo_console_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

export { COOKIE_NAME, SESSION_TTL_MS };

const enc = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacB64url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toB64url(new Uint8Array(sig));
}

/** 定长比较，避免通过响应时间逐字节猜测 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authSecret(): string | null {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 16 ? s : null;
}

function consolePassword(): string | null {
  const p = process.env.CONSOLE_PASSWORD;
  return p && p.length >= 6 ? p : null;
}

/** 运营台是否已配置鉴权。未配置时一律拒绝访问（fail closed）。 */
export function isAuthConfigured(): boolean {
  return authSecret() !== null && consolePassword() !== null;
}

export async function verifyPassword(input: string): Promise<boolean> {
  const expected = consolePassword();
  const secret = authSecret();
  if (!expected || !secret) return false;
  // 口令也走 HMAC：既定长比较，也让长度不通过时间侧信道泄漏
  const [a, b] = await Promise.all([hmacB64url(secret, `pw:${input}`), hmacB64url(secret, `pw:${expected}`)]);
  return constantTimeEqual(a, b);
}

export async function createSessionToken(): Promise<string | null> {
  const secret = authSecret();
  if (!secret) return null;
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `v1.${exp}`;
  return `${payload}.${await hmacB64url(secret, payload)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const secret = authSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expStr, sig] = parts;
  if (version !== "v1") return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  const expected = await hmacB64url(secret, `${version}.${expStr}`);
  return constantTimeEqual(sig, expected);
}

/** 统一的 cookie 属性：HttpOnly + SameSite=Lax；生产环境加 Secure */
export function sessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && !process.env.ALLOW_INSECURE_DEFAULTS,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** 只允许站内相对路径，防止 ?next= 变成开放重定向 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/console";
  if (!next.startsWith("/") || next.startsWith("//")) return "/console";
  if (next.startsWith("/console/login")) return "/console";
  return next;
}
