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

/* ------------------------------------------------------------------ *
 * 引用解析：从「这个页面」出发，这条引用到底指向哪个文件
 *
 * 这是整个导出最容易出错、也最容易被测试漏掉的地方。
 * 只检查「文件存在」和「页面里有这条引用」是不够的 ——
 * 页面在几层目录里，决定了同一个字符串会解析到不同的文件。
 * 例如位于 stores/<slug>/index.html 的页面写 `../style.css`，
 * 解析结果是 stores/style.css，而文件其实在站点根目录。
 * ------------------------------------------------------------------ */

/** 输出文件所在的目录层数：`index.html` = 0，`stores/x/index.html` = 2 */
export function pageDepth(filePath: string): number {
  const parts = filePath.split("/").filter(Boolean);
  return Math.max(0, parts.length - 1);
}

/** 从该层数的页面回到站点根所需的相对前缀 */
export function relativePrefix(depth: number): string {
  return "../".repeat(Math.max(0, depth));
}

/**
 * 把一条引用解析成「输出目录内的相对路径」。
 *
 * 返回：
 *  - `{ kind: "external" }` 外链、锚点、协议相对地址 —— 不检查
 *  - `{ kind: "local", path }` 站内引用，path 为归一化后的输出路径
 *  - `{ kind: "escape" }` 逃出站点根目录 —— 视为错误
 *
 * 同时支持以 `/` 开头的「根绝对」引用：在导出物里把它当作相对站点根处理，
 * 这样上传到子路径（如 GitHub Pages 项目站 https://user.github.io/repo/）
 * 也不会失效 —— 纯 `/xxx` 只在域名根目录部署时才正确。
 */
export function resolveReference(
  fromFile: string,
  ref: string,
): { kind: "external" } | { kind: "escape"; ref: string } | { kind: "local"; path: string } {
  const value = ref.trim();
  if (!value) return { kind: "external" };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith("//")) return { kind: "external" };
  if (value.startsWith("#")) return { kind: "external" };

  const isRooted = value.startsWith("/");
  const baseDir = isRooted ? [] : fromFile.split("/").slice(0, -1);
  const parts = [...baseDir];
  for (const raw of value.replace(/^\/+/, "").split("/")) {
    // 逐段 URL 解码后再比对文件系统路径：静态服务器会把 URL 解码后再找文件，
    // 因此 `/stores/%E4%B8%AD%E6%96%87…/` 指向的是磁盘上的 `stores/中文-slug/`。
    // 不decoding 会把所有非 ASCII slug 的链接误报成失效。
    // 逐段解码（而不是整串解码）可以避免 %2F 被当成路径分隔符。
    let seg = raw;
    // 含编码斜杠的段不解码：`a%2Fb.html` 在静态服务器上不会变成两级路径，
    // 解码后反而会凭空多出一层、可能匹配到不该匹配的文件
    const hasEncodedSeparator = /%2f|%5c/i.test(seg);
    if (seg.includes("%") && !hasEncodedSeparator) {
      try {
        seg = decodeURIComponent(seg);
      } catch {
        // 非法编码：保持原样，让它自然匹配不上
      }
    }
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return { kind: "escape", ref: value };
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  // 指向站点根：`/`、`./`、`../../` 这类目录引用实际打开的是根 index.html
  if (parts.length === 0) return { kind: "local", path: "index.html" };
  const path = parts.join("/");
  // 目录式链接（以 / 结尾）补上 index.html，才能判断文件是否存在
  return { kind: "local", path: value.endsWith("/") ? `${path}/index.html` : path };
}

export interface Reference {
  /** 引用所在页面 */
  from: string;
  /** 引用种类，便于定位问题 */
  kind: "stylesheet" | "image" | "link";
  /** 页面里写的原始引用 */
  ref: string;
  /** 解析结果 */
  resolved: string | null;
  ok: boolean;
  reason?: string;
}

const REFERENCE_PATTERNS: Array<{ kind: Reference["kind"]; re: RegExp }> = [
  { kind: "stylesheet", re: /<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g },
  { kind: "image", re: /<img[^>]+src="([^"]+)"/g },
  { kind: "link", re: /<a[^>]+href="([^"]+)"/g },
];

/**
 * 抽出每个页面里的站内引用，并解析出它应该指向哪个文件。
 *
 * 只看「页面里有没有这个字符串」是不够的：同一个字符串在不同层数的页面里
 * 指向不同文件。所以这里必须带上 from 与解析后的路径。
 */
export function collectReferences(files: ExportFile[], existingPaths: string[]): Reference[] {
  const have = new Set(existingPaths.map((p) => p.replace(/^\/+/, "")));
  const out: Reference[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".html")) continue;
    for (const { kind, re } of REFERENCE_PATTERNS) {
      for (const m of file.content.matchAll(re)) {
        const ref = m[1];
        const resolved = resolveReference(file.path, ref);
        if (resolved.kind === "external") continue;
        if (resolved.kind === "escape") {
          out.push({ from: file.path, kind, ref, resolved: null, ok: false, reason: "引用逃出了站点根目录" });
          continue;
        }
        const ok = have.has(resolved.path);
        out.push({
          from: file.path,
          kind,
          ref,
          resolved: resolved.path,
          ok,
          reason: ok ? undefined : `解析为 ${resolved.path}，但输出目录里没有这个文件`,
        });
      }
    }
  }
  return out;
}

/** 只返回解析不到的引用（导出前必须为空，否则上传后就是 404 / 裂图 / 丢样式） */
export function brokenReferences(files: ExportFile[], existingPaths: string[]): Reference[] {
  return collectReferences(files, existingPaths).filter((r) => !r.ok);
}

export interface AssetCheckResult {
  missing: string[];
  unused: string[];
}

/**
 * 资源检查。
 *
 * `missing` 现在基于**解析后的路径**判断，而不是字符串比对 ——
 * 后者曾经让「文章里写 assets/img/x.jpg、文件在站点根 assets/img/x.jpg」
 * 这种明显错误的引用通过检查。
 */
export function checkAssets(files: ExportFile[], assetPaths: string[]): AssetCheckResult {
  const allPaths = [...files.map((f) => f.path), ...assetPaths.map((p) => `assets/${p.replace(/^\/+/, "")}`)];
  const missing = brokenReferences(files, allPaths)
    .filter((r) => r.kind === "image")
    .map((r) => `${r.from} 里的 ${r.ref}（${r.reason ?? "无法解析"}）`);
  const referenced = new Set(collectReferences(files, allPaths).filter((r) => r.kind === "image").map((r) => r.resolved));
  const unused = assetPaths.map((p) => `assets/${p.replace(/^\/+/, "")}`).filter((p) => !referenced.has(p));
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
  /**
   * 页面在输出目录里的层数：`index.html` = 0，`stores/x/index.html` = 2。
   *
   * 由层数推导前缀，而不是让调用方手写 `"../"` —— 手写会错
   * （曾经门店页与品牌页写成了 `"../"`，而它们在两层目录里，
   * 结果样式表解析到 stores/style.css，页面上没有样式）。
   */
  depth: number;
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
<link rel="stylesheet" href="${relativePrefix(input.depth)}style.css">
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
export function renderStoreBody(store: Extract<PublicSnapshot, { kind: "store" }>, depth = 2): string {
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

  return `<div class="crumb"><a href="${relativePrefix(depth) || "./"}">← 返回全部</a></div>
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
export function renderBrandBody(brand: Extract<PublicSnapshot, { kind: "brand" }>, depth = 2): string {
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

  return `<div class="crumb"><a href="${relativePrefix(depth) || "./"}">← 返回全部</a></div>
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

/**
 * 把内容里的站内引用改写成「从本页出发」的相对路径。
 *
 * 约定：**正文里的站内引用一律按站点根书写**（`assets/img/x.jpg`、`/knowledge/y/`）。
 * 导出时按页面层数转成相对路径，而不是直接输出 `/assets/...` ——
 * 后者只在部署到域名根目录时正确；GitHub Pages 的项目站是
 * `https://user.github.io/repo/`，`/assets/...` 会指向域名根而 404。
 *
 * 外链、锚点、`data:` 一律不动。
 */
export function rewriteLocalRefs(html: string, depth: number): string {
  const prefix = relativePrefix(depth);
  return html.replace(/(\s(?:src|href))="([^"]*)"/g, (whole, attr: string, value: string) => {
    const v = value.trim();
    if (!v || v.startsWith("#") || v.startsWith("//")) return whole;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return whole; // http(s)/mailto/data 等
    // 按站点根归一化；逃出根目录的引用保持原样，交给引用检查报错
    const parts: string[] = [];
    let escaped = false;
    for (const seg of v.replace(/^\/+/, "").split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (parts.length === 0) {
          escaped = true;
          break;
        }
        parts.pop();
        continue;
      }
      parts.push(seg);
    }
    if (escaped) return whole;
    // 指向站点根（`/`、`./`）：改成从本页回根的相对路径。
    // 直接留 `/` 会在子路径部署时跳到域名根 —— 跑到别的站点去。
    if (parts.length === 0) return `${attr}="${prefix || "./"}"`;
    // 目录链接必须保留结尾斜杠：`knowledge/b/` 打开的是 knowledge/b/index.html，
    // 丢掉斜杠后静态托管可能不给你重定向，直接 404
    const trailing = v.endsWith("/") ? "/" : "";
    return `${attr}="${prefix}${parts.join("/")}${trailing}"`;
  });
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
