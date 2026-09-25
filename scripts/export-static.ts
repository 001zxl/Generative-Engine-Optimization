/**
 * 把审核通过的内容导出为静态站点包。
 *
 * 用法：
 *   STATIC_EXPORT_BASE_URL=https://geo.example.com \
 *   node scripts/export-static.ts [输出目录] [--assets <资源目录>]
 *
 * 默认输出目录 `static-site/`。产出物是纯 HTML + style.css + assets/，
 * 可以直接上传到 GitHub Pages / Cloudflare Pages 等静态托管。
 *
 * 三条硬规则：
 *  1. **只导出已公开内容**（public_pages.status='published' 与已发布知识页）
 *  2. **必须提供真实域名**：canonical 与 sitemap 写 localhost 会让搜索引擎
 *     与 AI 爬虫建立错误的规范地址，没有明确域名就拒绝导出
 *  3. **导出物里不能有任何内部信息**，扫描不过就拒绝产出（不留半成品目录）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  EXPORT_CSS,
  checkAssets,
  normalizeExportBaseUrl,
  renderBrandBody,
  renderDocument,
  renderIndexBody,
  renderRobots,
  renderSitemap,
  renderStoreBody,
  scanExportSafety,
  siteUrl,
  type ExportFile,
  type IndexEntry,
} from "../src/lib/static-export.ts";
import { markdownToHtml, markdownToPlainText } from "../src/lib/markdown.ts";
import { brandJsonLd, articleJsonLd, storeJsonLd } from "../src/lib/jsonld.ts";
import { collectPublishedArticles, collectPublishedPages, exportPreflight } from "../src/lib/db/repo-export.ts";

const args = process.argv.slice(2);
const outDirArg = args.find((a) => !a.startsWith("--"));
const assetsIdx = args.indexOf("--assets");
const assetsDir = assetsIdx >= 0 ? args[assetsIdx + 1] : undefined;

const outDir = path.resolve(outDirArg ?? "static-site");
const baseUrl = normalizeExportBaseUrl(process.env.STATIC_EXPORT_BASE_URL ?? process.env.APP_BASE_URL);
const siteName = (process.env.SITE_NAME ?? "GEO 可见度实验室").trim();

if (!baseUrl) {
  console.error(
    "拒绝导出：必须提供可公开访问的域名。\n" +
      "  STATIC_EXPORT_BASE_URL=https://你的域名 node scripts/export-static.ts\n" +
      "为什么必须：canonical 与 sitemap 会写进导出物。写成 localhost，\n" +
      "搜索引擎与 AI 爬虫会据此建立错误的规范地址 —— 比不导出更糟。",
  );
  process.exit(2);
}

// 输出目录不能是项目根或已有内容目录，避免把源文件覆盖掉
if (outDir === process.cwd() || outDir === path.dirname(outDir)) {
  console.error(`拒绝导出到 ${outDir}：请指定一个专用输出目录。`);
  process.exit(2);
}

const preflight = exportPreflight();
console.log(`[export] 站点域名：${baseUrl}`);
console.log(`[export] 已公开：门店 ${preflight.pages.stores} · 品牌 ${preflight.pages.brands} · 文章 ${preflight.articles}`);
for (const e of preflight.excluded) console.log(`[export]   跳过 ${e.kind}「${e.name}」：${e.reason}`);
for (const w of preflight.warnings) console.warn(`[export] ⚠️  ${w}`);

/* ---------------- 渲染 ---------------- */

const files: ExportFile[] = [];
const indexEntries: IndexEntry[] = [];
const sitemapEntries: Array<{ url: string; lastModified: string | null }> = [];

// 首页
const pages = collectPublishedPages();
const articles = collectPublishedArticles();

for (const page of pages) {
  const prefix = "../";
  const dir = page.entityType === "store" ? "stores" : "brands";
  const urlPath = `/${dir}/${encodeURIComponent(page.slug)}/`;

  // 按 kind 分支而不是先存成 boolean —— 后者会让类型收窄失效
  let title: string;
  let description: string;
  let bodyHtml: string;
  let jsonLd: unknown;

  if (page.snapshot.kind === "store") {
    const store = page.snapshot;
    title = store.name;
    description = [store.name, [store.city, store.district].filter(Boolean).join(""), store.category ?? "", store.address ?? ""]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 160);
    bodyHtml = renderStoreBody(store);
    jsonLd = storeJsonLd(store, { baseUrl, path: urlPath });
  } else {
    const brand = page.snapshot;
    title = brand.name;
    description = (brand.description?.trim() || `${brand.name} 的可核验信息`).slice(0, 160);
    bodyHtml = renderBrandBody(brand);
    jsonLd = brandJsonLd(brand, { baseUrl, path: urlPath });
  }

  files.push({
    path: `${dir}/${page.slug}/index.html`,
    content: renderDocument({
      siteName,
      title,
      description,
      canonicalPath: siteUrl(baseUrl, urlPath),
      bodyHtml,
      jsonLd,
      assetPrefix: prefix,
    }),
  });
  indexEntries.push({ url: urlPath, title, summary: description, kind: page.entityType });
  sitemapEntries.push({ url: siteUrl(baseUrl, urlPath), lastModified: page.publishedAt ?? page.updatedAt });
}

for (const article of articles) {
  const urlPath = `/knowledge/${encodeURIComponent(article.slug)}/`;
  const bodyHtml = `<div class="crumb"><a href="../../">← 返回全部</a></div><h1>${article.title.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!)}</h1>
<p class="meta">作者：${article.author} · 发布于 ${article.publishedAt.slice(0, 10)}</p>
${markdownToHtml(article.body)}
${
  article.evidences.length
    ? `<h2>证据与参考来源</h2><ul class="sources">${article.evidences
        .map((e) => `<li class="meta"><a href="${e.url}" rel="noopener">${e.title}</a>${e.publisher ? ` · ${e.publisher}` : ""}</li>`)
        .join("")}</ul>`
    : ""
}`;
  const description = markdownToPlainText(article.body, 160);
  const html = renderDocument({
    siteName,
    title: article.title,
    description,
    canonicalPath: siteUrl(baseUrl, urlPath),
    bodyHtml,
    jsonLd: articleJsonLd(
      { title: article.title, body: article.body, author: article.author, publishedAt: article.publishedAt, url: siteUrl(baseUrl, urlPath), description, citations: article.evidences.map((e) => e.url) },
      { baseUrl, path: urlPath },
    ),
    assetPrefix: "../../",
  });
  files.push({ path: `knowledge/${article.slug}/index.html`, content: html });
  indexEntries.push({ url: urlPath, title: article.title, summary: description, kind: "article" });
  sitemapEntries.push({ url: siteUrl(baseUrl, urlPath), lastModified: article.publishedAt });
}

// 索引页
files.push({
  path: "index.html",
  content: renderDocument({
    siteName,
    title: siteName,
    description: `${siteName}：经审核公开的门店、品牌与内容，信息均标注来源。`,
    canonicalPath: siteUrl(baseUrl, "/"),
    bodyHtml: renderIndexBody(siteName, indexEntries),
    assetPrefix: "",
  }),
});

// 样式、sitemap、robots
files.push({ path: "style.css", content: EXPORT_CSS });
files.push({ path: "sitemap.xml", content: renderSitemap([{ url: siteUrl(baseUrl, "/"), lastModified: null }, ...sitemapEntries]) });
files.push({ path: "robots.txt", content: renderRobots(baseUrl) });
// Pages 默认走 Jekyll，会忽略下划线开头的目录；这个文件让它按原样发布
files.push({ path: ".nojekyll", content: "" });

/* ---------------- 资源 ---------------- */

const assetPaths: string[] = [];
if (assetsDir) {
  const abs = path.resolve(assetsDir);
  if (!fs.existsSync(abs)) {
    console.error(`[export] 资源目录不存在：${abs}`);
    process.exit(2);
  }
  const walk = (dir: string, rel = ""): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
      else assetPaths.push(next);
    }
  };
  walk(abs);
  console.log(`[export] 资源目录：${abs}（${assetPaths.length} 个文件）`);
}

/* ---------------- 安全检查（先检查，再落盘） ---------------- */

const findings = scanExportSafety(files);
const blockers = findings.filter((f) => f.level === "block");
for (const f of findings) console.warn(`[export] ${f.level === "block" ? "✖" : "⚠️"}  ${f.path}：${f.message}`);
if (blockers.length > 0) {
  console.error(`\n[export] 拒绝产出：导出物里出现 ${blockers.length} 处内部信息。`);
  console.error("一旦上传，运营台路径 / API 路径 / 密钥就已经在公网上了，事后删除也可能已被抓取。");
  process.exit(1);
}

// 资源会被复制到输出目录的 assets/ 下，所以校验时要用产物路径而不是源目录路径。
// 正文里应引用 `assets/xxx`（相对站点根），否则上传后就是裂图。
const assetCheck = checkAssets(files, assetPaths.map((p) => `assets/${p}`));
if (assetCheck.missing.length > 0) {
  console.error(`\n[export] 拒绝产出：以下站内资源被引用但不存在，上传后会是裂图：`);
  for (const m of assetCheck.missing) console.error(`  · ${m}`);
  console.error(
    "资源约定：--assets 目录下的文件会被复制到输出目录的 assets/ 下，" +
      "因此正文里应写成 `assets/相对路径`（例如 assets/img/store.jpg）。",
  );
  process.exit(1);
}
if (assetCheck.unused.length > 0) {
  console.warn(`[export] ⚠️  ${assetCheck.unused.length} 个资源没有被任何页面引用：${assetCheck.unused.slice(0, 5).join("、")}`);
}

/* ---------------- 落盘 ---------------- */

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const target = path.join(outDir, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.content, "utf8");
}
if (assetsDir) {
  for (const rel of assetPaths) {
    const target = path.join(outDir, "assets", rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(path.resolve(assetsDir), rel), target);
  }
}

// 清单：文件 + 哈希，便于确认上传的确实是这一次导出的内容
const manifest = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  siteName,
  counts: { pages: pages.length, articles: articles.length, assets: assetPaths.length, files: files.length },
  files: files
    .map((f) => ({ path: f.path, sha256: crypto.createHash("sha256").update(f.content).digest("hex").slice(0, 16) }))
    .sort((a, b) => a.path.localeCompare(b.path)),
};
fs.writeFileSync(path.join(outDir, "export-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

const totalBytes = files.reduce((n, f) => n + Buffer.byteLength(f.content, "utf8"), 0);
console.log(`\n[export] ✓ 已导出到 ${outDir}`);
console.log(`[export]   HTML ${files.filter((f) => f.path.endsWith(".html")).length} 个 · 资源 ${assetPaths.length} 个 · 共 ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`[export]   把这个目录整个上传到静态托管即可（含 .nojekyll，GitHub Pages 会按原样发布）`);
console.log(`[export]   清单：${path.join(outDir, "export-manifest.json")}`);
