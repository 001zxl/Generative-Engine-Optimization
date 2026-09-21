/**
 * 受限抓取层：免费工具 A/B 的唯一出网入口。
 *
 * 安全要求（附件 §13）：
 *  - 只允许 http/https
 *  - SSRF 防护：拒绝内网 / 环回 / 链路本地 / 保留网段，IPv4 与 IPv6 一视同仁
 *  - **DNS 只解析一次，并固定连接到校验过的那个地址**（见下）
 *  - 限制重定向次数，且每个跳转都重新解析+校验
 *  - 超时、响应体大小上限、内容类型白名单
 *
 * ── 两个曾经真实存在的缺陷，以及现在为什么不会再犯 ──
 *
 * 1) **IPv6 曾用字符串前缀匹配，漏检 9 类地址。**
 *    旧实现用 `startsWith("fe80")` 判断链路本地 —— 但 fe80::/10 覆盖 fe80–febf，
 *    fe90::/fea0::/feb0:: 全部漏过。更严重的是 `::ffff:7f00:1`
 *    （127.0.0.1 的十六进制 IPv4 映射形式）也漏过，等于 SSRF 防护被绕过。
 *    现在改为**解析成 16 字节后做 CIDR 位运算**，并且对 IPv4 映射 / NAT64 / 6to4
 *    地址**提取内嵌的 IPv4 再走一遍 IPv4 规则**。
 *
 * 2) **DNS 校验与连接之间存在 TOCTOU（DNS 重绑定）。**
 *    旧实现先 dns.lookup 校验，随后交给 fetch —— 而 fetch 会**再解析一次**。
 *    攻击者可让第一次解析返回公网 IP（通过校验）、第二次返回 127.0.0.1（真正连上）。
 *    现在改为：**只解析一次，拿到地址后把连接目标钉死在这个地址上**
 *    （node:http/https 的 lookup 选项），底层不再自行解析。
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// 注意：HTTP 头必须是 latin-1（ByteString），这里只能使用 ASCII。
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

/* ==================================================================== *
 * 地址解析与判定
 * ==================================================================== */

function ipv4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const v = Number(parts[i]);
    if (!Number.isInteger(v) || v < 0 || v > 255 || parts[i].trim() === "") return null;
    out[i] = v;
  }
  return out;
}

/** 把 IPv6 解析成 16 字节；支持压缩写法、zone id、尾部点分 IPv4 */
export function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  // 尾部点分 IPv4 → 两个十六进制组
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = ipv4ToBytes(s.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = s.slice(0, lastColon + 1) + hi + ":" + lo;
  }

  if (!net.isIPv6(s)) return null;

  const hasCompression = s.includes("::");
  let head: string[];
  let rest: string[];
  if (hasCompression) {
    const idx = s.indexOf("::");
    const a = s.slice(0, idx);
    const b = s.slice(idx + 2);
    head = a ? a.split(":") : [];
    rest = b ? b.split(":") : [];
  } else {
    head = s.split(":");
    rest = [];
  }
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (hasCompression && missing < 1)) return null;

  const groups = [...head, ...Array(hasCompression ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;

  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i];
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  }
  return out;
}

function bytesInCidrV4(ip: Uint8Array, network: string, bits: number): boolean {
  const netBytes = ipv4ToBytes(network);
  if (!netBytes) return false;
  const full = Math.floor(bits / 8);
  const rem = bits % 8;
  for (let i = 0; i < full; i++) if (ip[i] !== netBytes[i]) return false;
  if (rem) {
    const mask = (0xff << (8 - rem)) & 0xff;
    if ((ip[full] & mask) !== (netBytes[full] & mask)) return false;
  }
  return true;
}

function bytesInCidrV6(ip: Uint8Array, network: string, bits: number): boolean {
  const netBytes = ipv6ToBytes(network);
  if (!netBytes) return false;
  const full = Math.floor(bits / 8);
  const rem = bits % 8;
  for (let i = 0; i < full; i++) if (ip[i] !== netBytes[i]) return false;
  if (rem) {
    const mask = (0xff << (8 - rem)) & 0xff;
    if ((ip[full] & mask) !== (netBytes[full] & mask)) return false;
  }
  return true;
}

/** 从 IPv4 映射 / NAT64 / 6to4 地址中取出内嵌的 IPv4 字节 */
function embeddedIpv4(ip: Uint8Array): { bytes: Uint8Array; label: string } | null {
  // ::ffff:0:0/96 —— IPv4-mapped
  if (bytesInCidrV6(ip, "::ffff:0:0", 96)) {
    return { bytes: ip.slice(12, 16), label: "IPv4 映射地址" };
  }
  // 64:ff9b::/96 —— NAT64 well-known prefix
  if (bytesInCidrV6(ip, "64:ff9b::", 96)) {
    return { bytes: ip.slice(12, 16), label: "NAT64 地址" };
  }
  // 2002::/16 —— 6to4，内嵌 IPv4 位于第 2–5 字节
  if (bytesInCidrV6(ip, "2002::", 16)) {
    return { bytes: ip.slice(2, 6), label: "6to4 地址" };
  }
  return null;
}

/* —— IPv4 保留网段（与之前一致，另加文档/保留段） —— */
const IPV4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // 含云元数据 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 中继（已废弃）
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // RFC 2544 基准测试段
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // 组播
  ["240.0.0.0", 4], // 保留
];

/* —— IPv6 保留网段 —— */
const IPV6_BLOCKED: Array<[string, number, string]> = [
  ["::", 128, "未指定地址"],
  ["::1", 128, "环回地址"],
  ["100::", 64, "discard-only 网段"],
  ["2001::", 32, "Teredo"],
  ["2001:db8::", 32, "文档网段"],
  ["fc00::", 7, "唯一本地地址 (ULA)"],
  ["fe80::", 10, "链路本地地址"],
  ["ff00::", 8, "IPv6 组播"],
];

function isBlockedIpv4Bytes(ip: Uint8Array): boolean {
  return IPV4_BLOCKED.some(([net, bits]) => bytesInCidrV4(ip, net, bits));
}

/**
 * 额外信任网段（逃生口）。默认**为空** = 最严格策略。
 * 仅在透明代理环境下显式配置，例如 198.18.0.0/15。
 */
let warned = false;
function extraTrustedV4(): Array<{ bytes: Uint8Array; bits: number; label: string }> {
  const out: Array<{ bytes: Uint8Array; bits: number; label: string }> = [];
  for (const part of (process.env.EXTRA_TRUSTED_CIDRS ?? "").split(",")) {
    const item = part.trim();
    if (!item) continue;
    const [addr, bitsRaw] = item.split("/");
    const bytes = ipv4ToBytes((addr ?? "").trim());
    const bits = Number(bitsRaw);
    if (!bytes || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      console.warn(`[fetch] EXTRA_TRUSTED_CIDRS 忽略非法条目: ${item}`);
      continue;
    }
    out.push({ bytes, bits, label: item });
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

function inExtraTrustedV4(ip: Uint8Array): boolean {
  return extraTrustedV4().some((c) => {
    const full = Math.floor(c.bits / 8);
    const rem = c.bits % 8;
    for (let i = 0; i < full; i++) if (ip[i] !== c.bytes[i]) return false;
    if (rem) {
      const mask = (0xff << (8 - rem)) & 0xff;
      if ((ip[full] & mask) !== (c.bytes[full] & mask)) return false;
    }
    return true;
  });
}

/**
 * 唯一的地址判定入口。
 * IPv4 走 IPv4 规则；IPv6 先查保留网段，再**对内嵌 IPv4 递归判定** ——
 * 这一步堵住了 ::ffff:7f00:1 这类十六进制映射形式的绕过。
 */
export function isBlockedAddress(ip: string): boolean {
  const trimmed = ip.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return isBlockedAddress(trimmed.slice(1, -1));
  }

  if (net.isIPv4(trimmed)) {
    const bytes = ipv4ToBytes(trimmed);
    if (!bytes) return true;
    if (inExtraTrustedV4(bytes)) return false;
    return isBlockedIpv4Bytes(bytes);
  }

  if (net.isIPv6(trimmed)) {
    const bytes = ipv6ToBytes(trimmed);
    if (!bytes) return true; // 解析不出就当不安全
    if (IPV6_BLOCKED.some(([net6, bits]) => bytesInCidrV6(bytes, net6, bits))) return true;
    const embedded = embeddedIpv4(bytes);
    if (embedded) return isBlockedIpv4Bytes(embedded.bytes);
    return false;
  }

  return true; // 既不是合法 IPv4 也不是合法 IPv6 → 不安全
}

/* ==================================================================== *
 * URL 与解析
 * ==================================================================== */

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

export interface ResolvedTarget {
  address: string;
  family: 4 | 6;
}

/**
 * 解析 + 校验，**只做一次**。
 * 返回的地址随后被钉死为连接目标，底层不再自行解析 —— 这是消除
 * DNS 重绑定（TOCTOU）的关键。
 */
export async function resolveAndValidate(
  hostname: string,
): Promise<{ ok: true; target: ResolvedTarget } | { ok: false; error: string }> {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    return { ok: false, error: "不允许访问本机地址。" };
  }
  if (lower.endsWith(".internal") || lower.endsWith(".local")) {
    return { ok: false, error: "不允许访问内网地址。" };
  }

  // 字面量 IP：直接判定，不需要解析
  if (net.isIP(lower)) {
    if (isBlockedAddress(lower)) return { ok: false, error: "不允许访问内网地址。" };
    return { ok: true, target: { address: lower, family: net.isIPv6(lower) ? 6 : 4 } };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(lower, { all: true });
  } catch {
    return { ok: false, error: "域名无法解析。" };
  }
  if (records.length === 0) return { ok: false, error: "域名无法解析。" };

  for (const r of records) {
    if (isBlockedAddress(r.address)) {
      return { ok: false, error: "该域名解析到内网地址，已拒绝访问。" };
    }
  }

  // 优先 IPv4（兼容性更好），全部地址都已校验过
  const pick = records.find((r) => r.family === 4) ?? records[0];
  return { ok: true, target: { address: pick.address, family: pick.family === 6 ? 6 : 4 } };
}

/* ==================================================================== *
 * 抓取
 * ==================================================================== */

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  bytes: number;
}

function requestOnce(
  url: URL,
  target: ResolvedTarget,
  opts: { method: "GET" | "HEAD"; accept: string; timeoutMs: number },
): Promise<RawResponse> {
  const mod = url.protocol === "https:" ? https : http;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

  return new Promise<RawResponse>((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port,
        path: url.pathname + url.search,
        method: opts.method,
        headers: {
          "user-agent": FETCH_UA,
          accept: opts.accept,
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "accept-encoding": "identity",
        },
        // 关键：DNS 已被我们解析并校验过，这里把连接目标钉死，
        // 不让底层（或任何代理）再解析一次。
        //
        // ⚠️ 必须同时支持两种回调形式：Node 在 `options.all === true` 时要求回调返回
        //    **数组**，否则会抛 ERR_INVALID_IP_ADDRESS 并让所有抓取静默失败。
        //    只实现三元组形式这个坑真实踩过 —— 改完必须真抓一次站点验证。
        lookup: (_hostname, options, callback) => {
          const wantAll = Boolean((options as { all?: boolean } | undefined)?.all);
          if (wantAll) {
            (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
              { address: target.address, family: target.family },
            ]);
          } else {
            (callback as unknown as (e: null, a: string, f: number) => void)(
              null,
              target.address,
              target.family,
            );
          }
        },
        // TLS SNI 与证书校验仍使用域名，而不是 IP
        servername: url.protocol === "https:" ? url.hostname : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            truncated = true;
            const keep = chunk.length - (bytes - MAX_BYTES);
            if (keep > 0) chunks.push(chunk.subarray(0, keep));
            bytes = MAX_BYTES;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => {
          void truncated;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            bytes,
          });
        };
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", reject);
      },
    );

    req.setTimeout(opts.timeoutMs, () => {
      req.destroy(new Error("TIMEOUT"));
    });
    req.on("error", reject);
    if (opts.method === "HEAD") req.end();
    else req.end();
  });
}

export interface FetchOptions {
  accept?: string;
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
    // 每一跳都重新解析 + 校验，并把结果钉死用于本次连接
    const resolved = await resolveAndValidate(current.hostname);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error,
        elapsedMs: Date.now() - started,
        redirects,
        finalUrl: current.toString(),
      };
    }

    let res: RawResponse;
    try {
      res = await requestOnce(current, resolved.target, {
        method,
        accept: opts.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        timeoutMs: TIMEOUT_MS,
      });
    } catch (e) {
      const msg = e instanceof Error && e.message === "TIMEOUT" ? "请求超时（12 秒）。" : "无法连接该地址。";
      return { ok: false, error: msg, elapsedMs: Date.now() - started, redirects, finalUrl: current.toString() };
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.location;
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
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        return { ok: false, error: "重定向到了不支持的协议，已拒绝。", elapsedMs: Date.now() - started, redirects };
      }
      redirects.push(next.toString());
      current = next;
      continue;
    }

    const contentType = String(res.headers["content-type"] ?? "");
    const typeOk = allowTypes.some((t) => contentType.toLowerCase().includes(t));
    const base: FetchResult = {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      finalUrl: current.toString(),
      contentType,
      elapsedMs: Date.now() - started,
      redirects,
    };

    if (!typeOk) {
      return { ...base, ok: false, error: `返回的内容类型是 ${contentType || "未知"}，不是可分析的网页。` };
    }
    if (method === "HEAD") return base;
    return { ...base, body: res.body, bytes: res.bytes };
  }

  return { ok: false, error: `重定向次数超过 ${MAX_REDIRECTS} 次。`, elapsedMs: Date.now() - started, redirects };
}

/** 抓取同源文件（robots.txt / sitemap.xml），失败不抛异常 */
export async function fetchText(
  rawUrl: string,
  allowTypes = ["text/plain", "text/html", "application/xml", "text/xml", "application/rss+xml", ""],
): Promise<FetchResult> {
  return fetchPage(rawUrl, { allowTypes, accept: "*/*" });
}

export function originOf(u: URL): string {
  return `${u.protocol}//${u.host}`;
}
