/**
 * 受限抓取层：免费工具 A/B 的唯一出网入口。
 *
 * 安全要求（附件 §13）：
 *  - 只允许 http/https
 *  - SSRF 防护：拒绝内网/环回/链路本地地址（含 DNS 解析后的真实 IP）
 *  - 限制重定向次数，且每个跳转都重新校验
 *  - 超时、响应体大小上限、内容类型白名单
 *
 * 公开工具是匿名可访问的，所以这一层是必须的，不是可选的。
 */
import dns from "node:dns/promises";
import net from "node:net";

// 注意：HTTP 头必须是 latin-1（ByteString），这里只能使用 ASCII。
// 早先版本在 UA 里写了中文，导致所有出网请求直接抛 TypeError。
export const FETCH_UA =
  "GEOCrawlerCheck/0.1 (+https://example.com/methods; AI-discoverability checker)";

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

export interface FetchResult {
  ok: boolean;
  status?: number;
  finalUrl?: string;
  contentType?: string;
  body?: string;
  bytes?: number;
  elapsedMs: number;
  redirects: string[];
  error?: string;
}

/* ---------------- URL 与网络地址校验 ---------------- */

export function normalizeUrl(input: string): { ok: true; url: URL } | { ok: false; error: string } {
  let raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "请输入网址。" };
  if (raw.length > 2048) return { ok: false, error: "网址过长。" };
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) raw = "https://" + raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "网址格式不正确。" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "只支持 http / https 网址。" };
  }
  if (!url.hostname || !url.hostname.includes(".")) {
    return { ok: false, error: "请输入完整域名，例如 example.com。" };
  }
  url.hash = "";
  return { ok: true, url };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // 解析不出就当不安全
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (b & mask) >>> 0;
  };
  return (
    inRange("0.0.0.0", 8) ||
    inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) ||
    inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.0.0.0", 24) ||
    inRange("192.0.2.0", 24) || // TEST-NET-1（文档用，不可路由）
    inRange("192.88.99.0", 24) || // 6to4 中继，已废弃
    inRange("192.168.0.0", 16) ||
    inRange("198.18.0.0", 15) ||
    inRange("198.51.100.0", 24) || // TEST-NET-2
    inRange("203.0.113.0", 24) || // TEST-NET-3
    inRange("224.0.0.0", 4) ||
    inRange("240.0.0.0", 4)
  );
}

/* ---------------------------------------------------------------------------
 * 逃生口：EXTRA_TRUSTED_CIDRS
 *
 * 为什么需要它：部分环境（企业网络、沙箱、评测平台）使用**透明代理**，
 * 把外网域名解析到一个固定的保留网段（例如 198.18.0.0/15，RFC 2544 基准测试段）。
 * 此时 SSRF 防护会把正常的外网请求一并拒绝。
 *
 * 默认**为空**，即保持最严格策略。只有显式配置后才会放行指定网段。
 * 一旦配置，部署者必须清楚：这些网段内的地址将可以被抓取。
 * ------------------------------------------------------------------------- */
interface TrustedCidr {
  base: number;
  mask: number;
  label: string;
}

let warned = false;

/** 每次调用重新读取环境变量：代价可忽略（每请求一次），但换来可测试性与可动态调整 */
function getExtraTrusted(): TrustedCidr[] {
  const out: TrustedCidr[] = [];
  const raw = process.env.EXTRA_TRUSTED_CIDRS ?? "";
  for (const part of raw.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const [addr, bitsRaw] = item.split("/");
    const base = ipv4ToInt(addr?.trim() ?? "");
    const bits = Number(bitsRaw);
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      console.warn(`[fetch] EXTRA_TRUSTED_CIDRS 忽略非法条目: ${item}`);
      continue;
    }
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    out.push({ base: (base & mask) >>> 0, mask, label: item });
  }
  if (out.length > 0 && !warned) {
    warned = true;
    console.warn(
      `[fetch] ⚠️ SSRF 防护已放宽：额外信任网段 ${out.map((c) => c.label).join(", ")}。` +
        `仅应在透明代理环境下临时启用，生产环境请留空 EXTRA_TRUSTED_CIDRS。`,
    );
  }
  return out;
}

function inExtraTrusted(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return getExtraTrusted().some((c) => ((n & c.mask) >>> 0) === c.base);
}

function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
  // IPv4-mapped ::ffff:a.b.c.d
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    // 显式配置的信任网段优先（默认不配置 → 行为与之前完全一致）
    if (inExtraTrusted(ip)) return false;
    return isPrivateIpv4(ip);
  }
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true;
}

/** 导出供单测使用：SSRF 判定是安全关键逻辑，必须有测试覆盖 */
export function isBlockedAddress(ip: string): boolean {
  return isBlockedIp(ip);
}

async function assertPublicHost(hostname: string): Promise<string | null> {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return "不允许访问本机地址。";
  if (lower.endsWith(".internal") || lower.endsWith(".local")) return "不允许访问内网地址。";
  if (net.isIP(lower)) return isBlockedIp(lower) ? "不允许访问内网地址。" : null;

  try {
    const records = await dns.lookup(lower, { all: true });
    if (records.length === 0) return "域名无法解析。";
    for (const r of records) {
      if (isBlockedIp(r.address)) return "该域名解析到内网地址，已拒绝访问。";
    }
    return null;
  } catch {
    return "域名无法解析。";
  }
}

/* ---------------- 抓取 ---------------- */

async function readCapped(res: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const t = await res.text();
    return { text: t.slice(0, MAX_BYTES), bytes: Buffer.byteLength(t), truncated: Buffer.byteLength(t) > MAX_BYTES };
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      chunks.push(value.subarray(0, Math.max(0, value.byteLength - (bytes - MAX_BYTES))));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes, truncated };
}

export interface FetchOptions {
  accept?: string;
  /** 允许的内容类型前缀 */
  allowTypes?: string[];
  method?: "GET" | "HEAD";
}

export async function fetchPage(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const started = Date.now();
  const redirects: string[] = [];
  const allowTypes = opts.allowTypes ?? ["text/html", "application/xhtml+xml", "text/plain"];
  const method = opts.method ?? "GET";

  const parsed = normalizeUrl(rawUrl);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, elapsedMs: Date.now() - started, redirects };
  }

  let current = parsed.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hostError = await assertPublicHost(current.hostname);
    if (hostError) {
      return { ok: false, error: hostError, elapsedMs: Date.now() - started, redirects, finalUrl: current.toString() };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": FETCH_UA,
          accept: opts.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      const cause =
        e instanceof Error && e.cause instanceof Error && e.cause.message
          ? `（${e.cause.message.slice(0, 120)}）`
          : "";
      const msg = aborted ? "请求超时（12 秒）。" : `无法连接该地址。${cause}`;
      return { ok: false, error: msg, elapsedMs: Date.now() - started, redirects, finalUrl: current.toString() };
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) {
        return {
          ok: false,
          status: res.status,
          error: "服务器返回重定向但未提供 Location。",
          elapsedMs: Date.now() - started,
          redirects,
          finalUrl: current.toString(),
        };
      }
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return { ok: false, error: "重定向目标地址无效。", elapsedMs: Date.now() - started, redirects };
      }
      redirects.push(next.toString());
      current = next;
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const typeOk = allowTypes.some((t) => contentType.toLowerCase().includes(t));
    const result: FetchResult = {
      ok: res.ok,
      status: res.status,
      finalUrl: current.toString(),
      contentType,
      elapsedMs: Date.now() - started,
      redirects,
    };

    if (!typeOk) {
      return { ...result, ok: false, error: `返回的内容类型是 ${contentType || "未知"}，不是可分析的网页。` };
    }
    if (method === "HEAD") return result;

    const { text, bytes } = await readCapped(res);
    return { ...result, body: text, bytes };
  }

  return { ok: false, error: `重定向次数超过 ${MAX_REDIRECTS} 次。`, elapsedMs: Date.now() - started, redirects };
}

/** 抓取同源文件（robots.txt / sitemap.xml），失败不抛异常 */
export async function fetchText(rawUrl: string, allowTypes = ["text/plain", "text/html", "application/xml", "text/xml", "application/rss+xml", "application/x-gzip", ""]): Promise<FetchResult> {
  return fetchPage(rawUrl, { allowTypes, accept: "*/*" });
}

export function originOf(u: URL): string {
  return `${u.protocol}//${u.host}`;
}
