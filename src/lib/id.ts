import { randomUUID, randomBytes, createHash } from "node:crypto";

/** 带前缀的 UUID，便于在日志和库里一眼看出实体类型 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

// 去掉容易混淆的 0/O/1/l/I
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** 可分享短链 slug（结果页 URL 用），12 位约 60 bit 熵，不可枚举 */
export function shareSlug(len = 12): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** IP 只存哈希，不存明文（§13 隐私要求） */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "geo-growth-engine";
  // 轻量哈希足够：目的只是同一 IP 去重与限流，不是密码学承诺
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = `${salt}:${ip}`;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** 内容哈希（证明"当时抓取/采样到的原始内容是什么"） */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
