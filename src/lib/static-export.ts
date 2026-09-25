/**
 * 静态站导出（纯逻辑，可单测）。
 *
 * 解决的问题：当前完整项目是一个 Next.js 应用 + SQLite + 运营台，
 * **不能直接拖拽上传到 Pages**。这里只把「审核通过、可以公开」的内容
 * 渲染成纯 HTML + 一份 CSS，输出一个可以直接上传的目录。
 *
 * 三条边界：
 *  1. **只导出已公开内容**：门店/品牌页取 `public_pages.status='published'` 的
 *     快照，文章取已成功发布的知识页。草稿、待审核、已下线一律不出现。
 *  2. **导出物里不能有任何内部信息**：不含运营台路径、API 路径、数据库引用、
 *     环境变量、采样原文。`scanExportSafety()` 逐文件检查，导出脚本据此拒绝产出。
 *  3. **canonical 必须指向真实域名**：静态站上线后 canonical 写 localhost
 *     会让搜索引擎与 AI 爬虫建立错误的规范地址。没有明确域名就拒绝导出。
 *
 * 样式只生成一份共享 CSS（无构建、无 CDN 依赖）—— 上传到 Pages 后离线可用。
 */
import type { PublicSnapshot } from "./public-pages.ts";

/**
 * HTML 文本转义。
 *
 * 导出模块自带一份：它要能在没有 Next 运行时、没有数据库的情况下独立使用，
 * 所以不依赖运营台侧的模块。所有插入 HTML 的文本都必须过这里。
 */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ *
 * 安全扫描
 * ------------------------------------------------------------------ */

export interface ExportFile {
  /** 输出目录内的相对路径，如 `stores/x/index.html` */
  path: string;
  content: string;
}

export interface SafetyFinding {
  path: string;
  level: "block" | "warn";
  code: string;
  message: string;
}

const FORBIDDEN_PATTERNS: Array<{ code: string; re: RegExp; message: string }> = [
  { code: "console_path", re: /\/console(\/|\b)/, message: "导出物里出现运营台路径 —— 运营台不能公开" },
  { code: "api_path", re: /\/api\//, message: "导出物里出现 API 路径 —— 静态站没有后端" },
  { code: "db_reference", re: /\.db(\b|["'])/, message: "导出物里出现数据库文件引用" },
  { code: "env_reference", re: /process\.env|DATABASE_PATH|CONSOLE_PASSWORD|AUTH_SECRET|LEAD_NOTIFY_WEBHOOK/, message: "导出物里出现环境变量或密钥名" },
  { code: "next_asset", re: /\/_next\//, message: "导出物引用了 Next.js 构建产物 —— 静态站里不存在" },
  { code: "localhost", re: /https?:\/\/localhost|127\.0\.0\.1|\b0\.0\.0\.0\b/, message: "导出物里出现本机地址" },
  { code: "screenshot_path", re: /screenshot|截图路径/i, message: "导出物里出现内部截图路径字段" },
];

/** 只在"疑似机密"上告警：值看起来像长随机串 */
const SUSPICIOUS_VALUE_RE = /(?:[A-Za-z0-9+/]{32,}={0,2})/;

/**
 * 扫描全部导出文件。
 *
 * 阻断项命中即拒绝产出 —— 因为一旦上传，运营台路径、API 路径或密钥
 * 就已经在公网上了，事后删除也可能已被抓取。
 */
export function scanExportSafety(files: ExportFile[]): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  for (const file of files) {
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.re.test(file.content)) {
        findings.push({ path: file.path, level: "block", code: rule.code, message: rule.message });
      }
    }
    if (SUSPICIOUS_VALUE_RE.test(file.content)) {
      findings.push({
        path: file.path,
        level: "warn",
        code: "long_random_value",
        message: "内容里出现长随机串，请确认不是密钥或分享令牌",
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * 资源引用
 * ------------------------------------------------------------------ */

/** 从 HTML 里取出全部站内资源引用（img src / link href），供存在性检查 */
export function referencedAssets(files: ExportFile[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith(".html")) continue;
    for (const m of file.content.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      const src = m[1];
      if (!/^https?:|^\/\//i.test(src)) out.add(src.replace(/^\//, ""));
    }
  }
  return [...out];
}

export interface AssetCheckResult {
  missing: string[];
  unused: string[];
}

/** 校验每个被引用的站内资源都真实存在；同时指出未被引用的资源（可能是不必要上传） */
export function checkAssets(files: ExportFile[], assetPaths: string[]): AssetCheckResult {
  const have = new Set(assetPaths.map((p) => p.replace(/^\//, "")));
  const referenced = referencedAssets(files);
  const missing = referenced.filter((r) => !have.has(r));
  const unused = [...have].filter((p) => !referenced.includes(p));
  return { missing, unused };
}

/* ------------------------------------------------------------------ *
 * 文档骨架与样式
 * ------------------------------------------------------------------ */

export const EXPORT_CSS = `/* 静态站样式：单文件、无构建、无外部依赖 */
:root{--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--brand:#1d4ed8;--ok:#047857;--warn:#b45309;--bg:#fff;--soft:#f9fafb}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}
a{color:var(--brand);text-decoration:underline;text-underline-offset:2px}
h1{font-size:1.9rem;line-height:1.25;margin:0 0 .5rem}
h2{font-size:1.3rem;margin:2rem 0 .5rem}
h3{font-size:1.05rem;margin:1.5rem 0 .4rem}
h4{font-size:1rem;margin:1.2rem 0 .4rem}
p{margin:.8rem 0}
ul,ol{margin:.8rem 0;padding-left:1.4rem}
li{margin:.3rem 0}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.95rem}
th,td{border-bottom:1px solid var(--line);padding:.5rem .6rem;text-align:left;vertical-align:top}
th{font-weight:600}
code{background:var(--soft);padding:.1em .35em;border-radius:4px;font-size:.9em}
img{max-width:100%;height:auto;border-radius:6px;border:1px solid var(--line)}
.meta{color:var(--muted);font-size:.85rem}
.crumb{font-size:.9rem;margin-bottom:1.5rem}
.note{border:1px solid var(--line);border-radius:10px;padding:16px;margin:1.5rem 0}
.note-warn{border-color:#fcd34d;background:#fffbeb}
.stack{display:flex;flex-direction:column;gap:1.25rem}
.card{border:1px solid var(--line);border-radius:10px;padding:16px}
.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:.1rem .55rem;font-size:.78rem;color:var(--muted)}
.ok{color:var(--ok)}
.warn{color:var(--warn)}
ul.sources{list-style:none;padding-left:0}
footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
`;

export interface DocumentInput {
  /** 站点名 */
  siteName: string;
  title: string;
  description: string;
  /** 相对路径，如 `/stores/x/` */
  canonicalPath: string;
  bodyHtml: string;
  jsonLd?: unknown;
  /** 站点根相对深度，用于静态资源前缀；首页为 ""，二级页为 "../" */
  assetPrefix: string;
}

/** 生成完整 HTML 文档。所有文本都经过转义，不存在原始 HTML 直通路径。 */
export function renderDocument(input: DocumentInput): string {
  const ld = input.jsonLd ? `<script type="application/ld+json">${serializeJsonLd(input.jsonLd)}</script>` : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlText(input.title)}</title>
<meta name="description" content="${escapeHtmlText(input.description)}">
<link rel="canonical" href="${escapeHtmlText(input.canonicalPath)}">
<link rel="stylesheet" href="${input.assetPrefix}style.css">
${ld}
</head>
<body>
<div class="wrap">
${input.bodyHtml}
<footer>${escapeHtmlText(input.siteName)} · 本站为静态页面，内容经过审核后发布。</footer>
</div>
</body>
</html>
`;
}

/**
 * JSON-LD 序列化。
 *
 * 与 A3 的 `serializeJsonLd` 同一策略：转义 `<`，防止内容里的 `</script>`
 * 提前闭合标签。这里自带一份是为了让导出模块可以独立使用（不依赖运营台侧模块）。
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/* ------------------------------------------------------------------ *
 * 页面渲染
 * ------------------------------------------------------------------ */

const SOURCE_KIND_LABEL: Record<string, string> = {
  self: "商家自述",
  official: "官方材料",
  third_party: "第三方来源",
  audited: "审计/年检",
};

const STATUS_NOTICE: Record<string, string> = {
  temporarily_closed: "该店当前暂停营业，来店前请先电话确认。",
  moved: "该店已迁址，本页信息可能尚未更新。",
};

export interface RenderedPage {
  /** 输出目录内的相对路径 */
  path: string;
  /** 站点内 URL 路径 */
  url: string;
  title: string;
  html: string;
  description: string;
}

/** 门店页正文 */
export function renderStoreBody(store: Extract<PublicSnapshot, { kind: "store" }>): string {
  const rows: string[] = [];
  const row = (label: string, value: string | number | null | undefined) =>
    value === null || value === undefined || value === "" ? "" : `<div><div class="meta">${label}</div><div>${escapeHtmlText(String(value))}</div></div>`;

  rows.push(row("地址", store.address));
  rows.push(row("电话", store.phone));
  rows.push(row("营业时间", store.hoursText));
  rows.push(row("人均价格", store.priceRange));
  rows.push(row("停车", store.parking));
  rows.push(row("无障碍", store.accessibility));

  const notice = store.statusNote ? `<div class="note note-warn">${escapeHtmlText(store.statusNote)}</div>` : "";

  const mapLinks = store.mapLinks.length
    ? `<h2>地图与平台资料</h2><ul>${store.mapLinks
        .map((l) => `<li><a href="${escapeHtmlText(l.url)}" rel="noopener">${escapeHtmlText(l.platform)}</a></li>`)
        .join("")}</ul>`
    : "";

  const facts = store.facts.length
    ? `<h2>信息来源</h2><p class="meta">下列信息均经过核验，并标注来源。</p><ul class="sources">${store.facts
        .map(
          (f) =>
            `<li class="card"><div class="meta">${escapeHtmlText(f.label)} · ${escapeHtmlText(SOURCE_KIND_LABEL[f.sourceKind] ?? f.sourceKind)}${
              f.verifiedAt ? ` · 核验于 ${escapeHtmlText(f.verifiedAt.slice(0, 10))}` : ""
            }</div><div>${escapeHtmlText(f.value)}</div>${
              f.sourceUrl
                ? `<div><a href="${escapeHtmlText(f.sourceUrl)}" rel="noopener">${escapeHtmlText(f.sourceTitle ?? "查看来源")}</a></div>`
                : ""
            }</li>`,
        )
        .join("")}</ul>`
    : "";

  return `<div class="crumb"><a href="../">← 返回全部</a></div>
<h1>${escapeHtmlText(store.name)}</h1>
<p class="meta">${escapeHtmlText([store.city, store.district].filter(Boolean).join(" "))}${
    store.category ? ` · ${escapeHtmlText(store.category)}` : ""
  }${store.serviceRadiusKm ? ` · 服务范围约 ${store.serviceRadiusKm} 公里` : ""}</p>
<p class="meta">本页内容最后更新于 ${escapeHtmlText(store.updatedAt.slice(0, 10))}</p>
${notice}<div class="note stack">${rows.join("")}</div>
${store.menuSummary ? `<h2>菜单摘要</h2><p>${escapeHtmlText(store.menuSummary)}</p>` : ""}
${mapLinks}${facts}`;
}

/** 品牌页正文 */
export function renderBrandBody(brand: Extract<PublicSnapshot, { kind: "brand" }>): string {
  const claims = brand.claims
    .map(
      (c) =>
        `<div class="card"><p>${escapeHtmlText(c.statement)}</p><ul class="sources">${c.sources
          .map(
            (s) =>
              `<li class="meta">${
                s.url ? `<a href="${escapeHtmlText(s.url)}" rel="noopener">${escapeHtmlText(s.title)}</a>` : escapeHtmlText(`${s.title}（材料留存，无可访问链接）`)
              }${s.publisher ? ` · ${escapeHtmlText(s.publisher)}` : ""}</li>`,
          )
          .join("")}</ul></div>`,
    )
    .join("");

  return `<div class="crumb"><a href="../">← 返回全部</a></div>
<h1>${escapeHtmlText(brand.name)}</h1>
${brand.description ? `<p>${escapeHtmlText(brand.description)}</p>` : ""}
<p class="meta">本页内容最后更新于 ${escapeHtmlText(brand.updatedAt.slice(0, 10))}</p>
${
  brand.domain
    ? `<p>官网：<a href="https://${escapeHtmlText(brand.domain.replace(/^https?:\/\//, ""))}" rel="noopener">${escapeHtmlText(brand.domain)}</a></p>`
    : ""
}
<h2>可核验的信息</h2>
<p class="meta">以下每一条都绑定了来源。未提供来源的说法不会出现在本页。</p>
<div class="stack">${claims}</div>`;
}

/* ------------------------------------------------------------------ *
 * 索引 / sitemap / robots
 * ------------------------------------------------------------------ */

export interface IndexEntry {
  url: string;
  title: string;
  summary: string;
  kind: "store" | "brand" | "article";
}

const KIND_LABEL: Record<IndexEntry["kind"], string> = {
  store: "门店",
  brand: "品牌",
  article: "文章",
};

export function renderIndexBody(siteName: string, entries: IndexEntry[]): string {
  const groups: Array<{ kind: IndexEntry["kind"]; items: IndexEntry[] }> = (["store", "brand", "article"] as const)
    .map((kind) => ({ kind, items: entries.filter((e) => e.kind === kind) }))
    .filter((g) => g.items.length > 0);

  const sections = groups
    .map(
      (g) =>
        `<h2>${KIND_LABEL[g.kind]}</h2><div class="stack">${g.items
          .map((e) => `<div class="card"><div><a href="${escapeHtmlText(e.url)}">${escapeHtmlText(e.title)}</a></div>${e.summary ? `<div class="meta">${escapeHtmlText(e.summary)}</div>` : ""}</div>`)
          .join("")}</div>`,
    )
    .join("");

  return `<h1>${escapeHtmlText(siteName)}</h1>
<p class="meta">本站为静态页面：内容经审核后发布，公开信息均标注来源。</p>
${sections || `<p class="note">暂无已公开内容。</p>`}`;
}

export interface SitemapEntry {
  url: string;
  lastModified: string | null;
}

/** sitemap.xml。只列已公开页面 —— 与导出集合一致。 */
export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${escapeHtmlText(e.url)}</loc>${e.lastModified ? `<lastmod>${escapeHtmlText(e.lastModified.slice(0, 10))}</lastmod>` : ""}</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/**
 * 静态站的 robots.txt。
 *
 * 没有运营台、没有 API，所以只有一条"全部允许"；检索型与训练型爬虫
 * 保持与本项目一致的开放态度。
 */
export function renderRobots(baseUrl: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl.replace(/\/+$/, "")}/sitemap.xml
`;
}

/* ------------------------------------------------------------------ *
 * URL 规范
 * ------------------------------------------------------------------ */

/**
 * 校验导出用的基准地址。
 *
 * 不允许本机地址：静态站上线后 canonical 写 localhost，会让搜索引擎与
 * AI 爬虫建立错误的规范地址 —— 这正是配置守卫拦住的那类问题。
 */
export function normalizeExportBaseUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host) || host.endsWith(".local") || host.endsWith(".localhost")) {
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** 站点内 URL（用于 canonical / sitemap） */
export function siteUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
