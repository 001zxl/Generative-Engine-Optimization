/**
 * 静态导出端到端验收。
 *
 * 只跑在全新临时库上。它真的执行一次导出，然后检查磁盘上的产物：
 *  - 已公开内容在内，草稿/待审核/已下线内容**不在**
 *  - 产物里没有任何内部信息（运营台、API、数据库、密钥、本机地址）
 *  - canonical / sitemap 指向导出域名
 *  - 图片等站内资源确实被复制过来
 *
 * 用法：
 *   STATIC_EXPORT_BASE_URL=https://geo.example.com \
 *   node --experimental-strip-types scripts/e2e-static-export.ts <DB_PATH>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const DB = process.argv[2];
if (!DB) {
  console.error("用法：node scripts/e2e-static-export.ts <DB_PATH>");
  process.exit(1);
}
const resolved = path.resolve(DB);
if (resolved === path.join(process.cwd(), "data", "geo.db")) {
  console.error("拒绝在试点库上运行。");
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;

let pass = 0;
const failed: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  -> " + detail : ""}`);
  } else {
    failed.push(name);
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
};

/** 极简静态服务器：按静态托管的实际行为提供文件（目录自动找 index.html） */
async function serveStatic(dir: string, opts: { mountAt?: string } = {}): Promise<{ port: number; close: () => void }> {
  const http = await import("node:http");
  const mount = opts.mountAt ?? "/";
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith(mount)) {
        res.writeHead(404).end("not mounted");
        return;
      }
      let rel = pathname.slice(mount.length);
      if (rel.endsWith("/") || rel === "") rel += "index.html";
      const target = path.join(dir, rel);
      // 防目录穿越
      if (!path.resolve(target).startsWith(path.resolve(dir))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      const body = fs.readFileSync(target);
      const type = target.endsWith(".css") ? "text/css" : target.endsWith(".html") ? "text/html; charset=utf-8" : target.endsWith(".xml") ? "application/xml" : target.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
      res.writeHead(200, { "content-type": type }).end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { port, close: () => server.close() };
}

const L = await import("../src/lib/db/repo-local.ts");
const R = await import("../src/lib/db/repo-domains.ts");
const PP = await import("../src/lib/db/repo-public.ts");

const BASE = "https://geo.example.com";
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "static-export-"));
const ASSETS = fs.mkdtempSync(path.join(os.tmpdir(), "static-assets-"));

/* ---------- 准备：一个已公开门店 / 一个草稿门店 / 一篇已发布文章 ---------- */
const storeId = L.createStore({ name: "海鹏菜馆", city: "潍坊市", district: "坊子区", address: "六马路 1 号", category: "餐饮/炒菜" });
L.updateStore(storeId, { status: "active" });
L.addStoreFact({ storeId, factKey: "name", value: "海鹏菜馆", sourceKind: "official", sourceTitle: "营业执照" });
L.addStoreFact({ storeId, factKey: "address", value: "六马路 1 号", sourceKind: "official", sourceTitle: "营业执照" });
L.addStoreFact({ storeId, factKey: "phone", value: "0536-1234567", sourceKind: "official", sourceTitle: "营业执照" });
for (const f of L.listStoreFacts(storeId)) L.verifyStoreFact(f.id, "https://x.example/license");
L.setStoreHours(storeId, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, closed: false, opens: "09:00", closes: "21:30" })));
const storePageId = PP.upsertStorePage(storeId);
PP.publishPage(storePageId);

// 草稿门店：绝不能出现在导出物里
const draftStoreId = L.createStore({ name: "草稿门店内部代号", city: "潍坊市" });
PP.upsertStorePage(draftStoreId);

// 品牌 + 已发布文章（含一张本地图片，用来验证资源复制）
const brandId = R.createBrand({ name: "示例品牌", domain: "brand.example", description: "用于导出的示例品牌" });
const claimId = R.createClaim({ claimKey: "capacity", statement: "月产能 200 吨", brandId });
R.addEvidence({ claimId, kind: "website", title: "产能说明", url: "https://brand.example/capacity", evidenceLevel: "official" });
R.reviewClaim(claimId, "approved");
const brandPageId = PP.upsertBrandPage(brandId);
PP.publishPage(brandPageId);

// 图片：正文引用 assets/store.jpg
fs.mkdirSync(path.join(ASSETS, "img"), { recursive: true });
fs.writeFileSync(path.join(ASSETS, "img", "store.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

const assetId = R.createAsset({
  kind: "article",
  title: "关于我们门店的说明",
  bodyMd: "## 结论\n海鹏菜馆是一家主营炒菜的家常餐馆。\n\n![门头照片](assets/img/store.jpg)\n\n## 来源\n- [产能说明](https://brand.example/capacity)",
  claimIds: [claimId],
});
R.reviewAsset(assetId, "approved");
const P = await import("../src/lib/publishing.ts");
const dispatchId = P.createPublicationDispatch(assetId, "own_site");
await P.executePublicationDispatch(dispatchId);

/* ---------- 导出 ---------- */
console.log("== 1. 执行导出 ==");
let out = "";
try {
  out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/export-static.ts", OUT, "--assets", ASSETS],
    { env: { ...process.env, STATIC_EXPORT_BASE_URL: BASE, SITE_NAME: "示例站点" }, encoding: "utf8" },
  );
  check("导出命令执行成功", true);
} catch (e) {
  check("导出命令执行成功", false, e instanceof Error ? e.message.slice(0, 300) : String(e));
}
console.log(out.split("\n").filter((l) => l.startsWith("[export]")).join("\n"));

const readFile = (rel: string) => fs.readFileSync(path.join(OUT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(OUT, rel));

console.log("== 2. 只导出已公开内容 ==");
// 目录名是「名称-实体id 片段」的 slug，不能硬编码 —— 扫描发现
const dirsOf = (kind: string) => (fs.existsSync(path.join(OUT, kind)) ? fs.readdirSync(path.join(OUT, kind)) : []);
const storeDirs = dirsOf("stores");
const brandDirs = dirsOf("brands");
const storeRel = storeDirs.length === 1 ? `stores/${storeDirs[0]}/index.html` : "";
const brandRel = brandDirs.length === 1 ? `brands/${brandDirs[0]}/index.html` : "";


check("首页已生成", exists("index.html"));
check("恰好生成 1 个门店页", storeDirs.length === 1, storeDirs.join(","));
check("门店页目录名带实体后缀（同名不冲突）", !!storeDirs[0] && storeDirs[0].startsWith("海鹏菜馆-"), storeDirs[0]);
check("品牌页已生成", brandDirs.length === 1, brandDirs.join(","));
const knowledgeDirs = fs.existsSync(path.join(OUT, "knowledge")) ? fs.readdirSync(path.join(OUT, "knowledge")) : [];
check("文章页已生成", knowledgeDirs.length === 1, knowledgeDirs.join(","));

const indexHtml = readFile("index.html");
check("索引含已公开门店", indexHtml.includes("海鹏菜馆"));
check("索引不含草稿门店", !indexHtml.includes("草稿门店内部代号"), "草稿内容绝不能出现在导出物里");

const allHtml = (function walk(dir: string): string {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".html") ? fs.readFileSync(path.join(dir, e.name), "utf8") : ""))
    .join("\n");
})(OUT);
check("任何页面都不含草稿门店", !allHtml.includes("草稿门店内部代号"));

console.log("== 3. 产物里没有内部信息 ==");
const scan = execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `
import fs from "node:fs";
import path from "node:path";
const { scanExportSafety } = await import("./src/lib/static-export.ts");
const root = process.argv[1];
const files = [];
const walk = (dir, rel = "") => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), next);
    else if (/\\.(html|css|txt|xml|json)$/.test(e.name)) files.push({ path: next, content: fs.readFileSync(path.join(dir, e.name), "utf8") });
  }
};
walk(root);
const findings = scanExportSafety(files);
console.log(JSON.stringify({ count: files.length, blockers: findings.filter(f => f.level === "block"), warnings: findings.filter(f => f.level === "warn") }));
`,
    OUT,
  ],
  { encoding: "utf8" },
);
const scanResult = JSON.parse(scan.trim()) as { count: number; blockers: Array<{ path: string; message: string }>; warnings: unknown[] };
check("扫描了全部文本产物", scanResult.count >= 5, `${scanResult.count} 个文件`);
check("没有任何内部信息", scanResult.blockers.length === 0, JSON.stringify(scanResult.blockers));
check("产物里没有 .env / 数据库", !exists(".env") && !exists("data/geo.db"));
check("产物里没有运营台目录", !exists("console"));

console.log("== 4. canonical 与 sitemap 指向导出域名 ==");
const storeHtml = readFile(storeRel);
check("门店页 canonical 指向导出域名", storeHtml.includes(`<link rel="canonical" href="${BASE}/stores/`), (storeHtml.match(/canonical" href="([^"]+)"/) ?? [])[1]);
check("canonical 不含 localhost", !storeHtml.includes("localhost"));
const sitemap = readFile("sitemap.xml");
check("sitemap 含门店页", sitemap.includes("<loc>https://geo.example.com/stores/"));
check("sitemap 含文章页", sitemap.includes("<loc>https://geo.example.com/knowledge/"));
check("sitemap 是合法 XML 头", sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
check("robots 指向导出域名的 sitemap", readFile("robots.txt").includes("https://geo.example.com/sitemap.xml"));
check("含 .nojekyll（GitHub Pages 按原样发布）", exists(".nojekyll"));

console.log("== 5. 图片与样式 ==");
check("样式文件已生成", exists("style.css"));
check("图片已复制到 assets/", exists("assets/img/store.jpg"), fs.existsSync(path.join(OUT, "assets")) ? fs.readdirSync(path.join(OUT, "assets")).join(",") : "无 assets 目录");
const articleHtml = readFile(`knowledge/${knowledgeDirs[0]}/index.html`);
check("文章页引用了图片", articleHtml.includes("assets/img/store.jpg"));
check("图片有 alt", articleHtml.includes('alt="门头照片"'));
check("样式表被引用", articleHtml.includes("style.css"));
check("文章表格之外的结构仍在（标题/列表）", /<h2[\s>]/.test(articleHtml) && /<ul[\s>]/.test(articleHtml));

console.log("== 6. 结构化数据 ==");
const ldMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(storeHtml);
check("门店页含 JSON-LD", !!ldMatch);
if (ldMatch) {
  const ld = JSON.parse(ldMatch[1].replace(/\\u003c/g, "<")) as Record<string, unknown>;
  check("JSON-LD 类型为 Restaurant", ld["@type"] === "Restaurant", String(ld["@type"]));
  check("JSON-LD 名称与页面一致", ld.name === "海鹏菜馆");
}

console.log("== 7. 清单可核对 ==");
check("生成导出清单", exists("export-manifest.json"));
const manifest = JSON.parse(readFile("export-manifest.json")) as { baseUrl: string; files: Array<{ path: string; sha256: string }> };
check("清单记录域名", manifest.baseUrl === BASE, manifest.baseUrl);
check("清单含全部 HTML", manifest.files.filter((f) => f.path.endsWith(".html")).length === 4, `${manifest.files.length} 个文件`);
check("清单有哈希", manifest.files.every((f) => f.sha256.length === 16));

console.log("== 8. 按浏览器的方式验证：从每个页面出发，每条引用都能取到文件 ==");
// 前面检查的是「文件在磁盘上」+「页面里有这条引用」。
// 这两件事都成立，页面依然可能是坏的 —— 同一个字符串在不同层数的页面里
// 指向不同文件（样式表、返回链接、文章图片都踩过这个坑）。
// 所以这里把导出目录用静态服务器跑起来，按浏览器的方式逐条请求。
const served = await serveStatic(OUT);
const rootUrl = `http://127.0.0.1:${served.port}/`;

const htmlFiles = (function walkHtml(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkHtml(path.join(dir, e.name), next));
    else if (e.name.endsWith(".html")) out.push(next);
  }
  return out;
})(OUT);

interface RefCheck { page: string; ref: string; status: number; url: string }
const refResults: RefCheck[] = [];
for (const page of htmlFiles) {
  const pageUrl = new URL(page.split("/").map(encodeURIComponent).join("/"), rootUrl).toString();
  const res = await fetch(pageUrl);
  check(`页面可访问：${page}`, res.status === 200, `HTTP ${res.status} ${pageUrl}`);
  const html = await res.text();
  const refs: Array<{ ref: string; attr: string }> = [];
  for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)) refs.push({ ref: m[1], attr: "stylesheet" });
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) refs.push({ ref: m[1], attr: "image" });
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"/g)) refs.push({ ref: m[1], attr: "link" });
  for (const { ref, attr } of refs) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) || ref.startsWith("#")) continue;
    // 浏览器就是这样解析的：相对当前页面 URL
    const target = new URL(ref, pageUrl);
    if (new URL(target).origin !== new URL(rootUrl).origin) continue;
    const r = await fetch(target, { redirect: "follow" });
    refResults.push({ page, ref, status: r.status, url: target.toString() });
    check(`  ${attr} 可取：${page} → ${ref}`, r.status === 200, `HTTP ${r.status} ${target.pathname}`);
  }
}
check("至少检查了 3 类引用（样式表 / 图片 / 链接）", new Set(refResults.map((r) => r.ref)).size >= 3, `${refResults.length} 条`);

console.log("== 9. 子路径部署也要能用（GitHub Pages 项目站）==");
// 项目站地址形如 https://user.github.io/repo/ —— 站点不在域名根目录。
// 用相对路径就是为了这种场景；根绝对路径（/style.css）在这里会 404。
const sub = await serveStatic(OUT, { mountAt: "/site/" });
const subBase = `http://127.0.0.1:${sub.port}/site/`;
for (const page of ["index.html", "stores/" + storeDirs[0] + "/index.html", "knowledge/" + knowledgeDirs[0] + "/index.html"]) {
  const pageUrl = new URL(page.split("/").map(encodeURIComponent).join("/"), subBase).toString();
  const res = await fetch(pageUrl);
  check(`子路径下页面可访问：${page}`, res.status === 200, `HTTP ${res.status}`);
  const html = await res.text();
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) || ref.startsWith("#")) continue;
    const target = new URL(ref, pageUrl);
    const r = await fetch(target);
    check(`  子路径下引用可取：${ref}`, r.status === 200, `HTTP ${r.status} ${target.pathname}`);
  }
}
sub.close();
served.close();

console.log("== 10. 没有域名时必须拒绝导出 ==");
let refused = false;
let stderr = "";
try {
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/export-static.ts", path.join(OUT, "..", "should-not-exist")], {
    env: { ...process.env, STATIC_EXPORT_BASE_URL: "http://localhost:3100" },
    encoding: "utf8",
    stdio: "pipe",
  });
} catch (e) {
  refused = true;
  stderr = String((e as { stderr?: string }).stderr ?? "");
}
check("本机地址被拒绝导出", refused, stderr.split("\n")[0] ?? "");

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(ASSETS, { recursive: true, force: true });

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
