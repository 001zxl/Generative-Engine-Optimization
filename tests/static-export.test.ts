import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_CSS,
  brokenReferences,
  checkAssets,
  collectReferences,
  normalizeExportBaseUrl,
  pageDepth,
  relativePrefix,
  renderDocument,
  renderIndexBody,
  renderRobots,
  renderSitemap,
  renderStoreBody,
  resolveReference,
  rewriteLocalRefs,
  scanExportSafety,
  siteUrl,
  type ExportFile,
} from "../src/lib/static-export.ts";
import { markdownToHtml } from "../src/lib/markdown.ts";
import type { StoreSnapshot } from "../src/lib/public-pages.ts";

/**
 * 静态导出。
 *
 * 三条底线各有一组用例：
 *  1. 导出物里不能有内部信息（运营台 / API / 密钥 / 数据库 / 本机地址）
 *  2. canonical 必须指向真实域名，本机地址一律拒绝
 *  3. 被引用的站内资源必须真实存在，否则上传后是裂图
 */

function storeSnapshot(over: Partial<StoreSnapshot> = {}): StoreSnapshot {
  return {
    kind: "store",
    name: "海鹏菜馆",
    city: "潍坊市",
    district: "坊子区",
    address: "六马路 1 号",
    category: "餐饮/炒菜",
    serviceRadiusKm: 3,
    phone: "0536-1234567",
    hoursText: "每日 09:00-21:30",
    menuSummary: null,
    priceRange: null,
    parking: null,
    accessibility: null,
    statusNote: null,
    facts: [
      { key: "address", label: "地址", value: "六马路 1 号", sourceKind: "official", sourceUrl: "https://x.example/lic", sourceTitle: "营业执照", verifiedAt: "2026-09-01" },
    ],
    mapLinks: [{ platform: "高德地图", label: "高德地图", url: "https://amap.com/x" }],
    updatedAt: "2026-09-25T00:00:00Z",
    ...over,
  };
}

/* ---------------- 安全扫描 ---------------- */

test("导出物含运营台路径时判为阻断", () => {
  const files: ExportFile[] = [{ path: "index.html", content: `<a href="/console/leads">管理</a>` }];
  const f = scanExportSafety(files);
  assert.ok(f.some((x) => x.code === "console_path" && x.level === "block"), JSON.stringify(f));
});

test("API 路径、数据库、环境变量、Next 构建产物都判为阻断", () => {
  for (const [code, content] of [
    ["api_path", `<form action="/api/leads">`],
    ["db_reference", `数据库位于 data/geo.db`],
    ["env_reference", `process.env.CONSOLE_PASSWORD`],
    ["next_asset", `<script src="/_next/static/x.js">`],
  ] as const) {
    const f = scanExportSafety([{ path: "a.html", content }]);
    assert.ok(f.some((x) => x.code === code && x.level === "block"), `${code}: ${JSON.stringify(f)}`);
  }
});

test("本机地址判为阻断（canonical 写 localhost 会污染搜索收录）", () => {
  for (const content of ["http://localhost:3100/", "http://127.0.0.1/x", "0.0.0.0"]) {
    const f = scanExportSafety([{ path: "a.html", content }]);
    assert.ok(f.some((x) => x.code === "localhost" && x.level === "block"), content);
  }
});

test("干净的导出物没有任何发现", () => {
  const files: ExportFile[] = [
    { path: "index.html", content: renderDocument({ siteName: "站点", title: "首页", description: "说明", canonicalPath: "https://geo.example.com/", bodyHtml: "<h1>首页</h1>", depth: 0 }) },
    { path: "style.css", content: "body{color:#111}" },
  ];
  assert.deepEqual(scanExportSafety(files), []);
});

test("疑似长随机串只给告警，不阻断", () => {
  const f = scanExportSafety([{ path: "a.html", content: "token=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3OA==" }]);
  assert.ok(f.some((x) => x.code === "long_random_value" && x.level === "warn"));
  assert.ok(!f.some((x) => x.level === "block"));
});

/* ---------------- 基准地址 ---------------- */

test("必须提供真实域名，本机与非法值一律拒绝", () => {
  assert.equal(normalizeExportBaseUrl("https://geo.example.com"), "https://geo.example.com");
  assert.equal(normalizeExportBaseUrl("https://geo.example.com/"), "https://geo.example.com");
  assert.equal(normalizeExportBaseUrl("https://geo.example.com/sub/"), "https://geo.example.com/sub");
  for (const bad of [null, undefined, "", "localhost", "http://localhost:3100", "http://127.0.0.1", "http://app.localhost", "ftp://x.com", "not a url"]) {
    assert.equal(normalizeExportBaseUrl(bad), null, String(bad));
  }
});

test("站点 URL 拼接不产生双斜杠", () => {
  assert.equal(siteUrl("https://x.example.com", "/a/"), "https://x.example.com/a/");
  assert.equal(siteUrl("https://x.example.com/", "a"), "https://x.example.com/a");
});

/* ---------------- 文档骨架 ---------------- */

test("文档含 doctype、lang、标题、描述与 canonical", () => {
  const html = renderDocument({ siteName: "站点", title: "标题", description: "描述", canonicalPath: "https://x.example.com/a/", bodyHtml: "<p>正文</p>", depth: 2 });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>标题<\/title>/);
  assert.match(html, /<meta name="description" content="描述">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.example\.com\/a\/">/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/style\.css">/, "两层目录的页面应引用 ../../style.css");
});

test("标题与描述里的 HTML 被转义", () => {
  const html = renderDocument({ siteName: "s", title: `<script>alert(1)</script>`, description: `"quoted"`, canonicalPath: "/", bodyHtml: "", depth: 0 });
  assert.ok(!html.includes("<script>alert"), html);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;quoted&quot;/);
});

test("JSON-LD 里的 < 被转义，防止提前闭合 script", () => {
  const html = renderDocument({ siteName: "s", title: "t", description: "d", canonicalPath: "/", bodyHtml: "", depth: 0, jsonLd: { name: "</script><script>alert(1)</script>" } });
  assert.ok(!html.includes("</script><script>"), html);
  assert.match(html, /\\u003c/);
});

/* ---------------- 页面正文 ---------------- */

test("门店正文含地址/电话/营业时间/来源/地图链接", () => {
  const html = renderStoreBody(storeSnapshot());
  for (const needle of ["海鹏菜馆", "六马路 1 号", "0536-1234567", "每日 09:00-21:30", "信息来源", "营业执照", "https://amap.com/x"]) {
    assert.ok(html.includes(needle), needle);
  }
});

test("门店正文不含内部字段（如 status_note）", () => {
  const html = renderStoreBody(storeSnapshot({ facts: [] }));
  assert.ok(!html.includes("status_note"));
});

test("暂停营业提示会显著显示", () => {
  const html = renderStoreBody(storeSnapshot({ statusNote: "该店当前暂停营业，来店前请先电话确认。" }));
  assert.match(html, /note-warn/);
  assert.ok(html.includes("暂停营业"));
});

test("缺失字段不留空标签", () => {
  const html = renderStoreBody(storeSnapshot({ phone: null, hoursText: null, address: null, facts: [], mapLinks: [] }));
  assert.ok(!html.includes("<div></div>"), html);
});

/* ---------------- 索引 / sitemap / robots ---------------- */

test("索引按类型分组，没有内容时给出明确提示", () => {
  const empty = renderIndexBody("站点", []);
  assert.ok(empty.includes("暂无已公开内容"));
  const html = renderIndexBody("站点", [
    { url: "/stores/a/", title: "门店 A", summary: "说明", kind: "store" },
    { url: "/knowledge/b/", title: "文章 B", summary: "", kind: "article" },
  ]);
  assert.ok(html.includes("门店") && html.includes("文章"));
  assert.ok(html.includes("/stores/a/"));
});

test("sitemap 只含传入的 URL 且是合法 XML", () => {
  const xml = renderSitemap([{ url: "https://x.example.com/", lastModified: "2026-09-25T00:00:00Z" }, { url: "https://x.example.com/a/", lastModified: null }]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes("<loc>https://x.example.com/</loc>"));
  assert.ok(xml.includes("<lastmod>2026-09-25</lastmod>"));
  assert.equal((xml.match(/<url>/g) ?? []).length, 2);
});

test("robots 指向真实域名的 sitemap", () => {
  const txt = renderRobots("https://geo.example.com/");
  assert.match(txt, /Sitemap: https:\/\/geo\.example\.com\/sitemap\.xml/);
  assert.ok(txt.includes("Allow: /"));
});

/* ---------------- 资源 ---------------- */

test("资源检查基于解析后的路径，而不是字符串比对", () => {
  // 页面在 assets 子目录里写 assets/x.png，解析结果是 assets/assets/x.png —— 不存在
  const wrong: ExportFile[] = [{ path: "knowledge/a/index.html", content: `<img src="assets/x.png">` }];
  assert.equal(brokenReferences(wrong, ["knowledge/a/index.html", "assets/x.png"]).length, 1);

  // 写成从本页出发的正确相对路径时通过
  const right: ExportFile[] = [{ path: "knowledge/a/index.html", content: `<img src="../../assets/x.png">` }];
  assert.deepEqual(brokenReferences(right, ["knowledge/a/index.html", "assets/x.png"]), []);
});

test("未被引用的资源会被指出（可能不必上传）", () => {
  const files: ExportFile[] = [{ path: "index.html", content: `<img src="assets/x.png"><img src="assets/y.png">` }];
  const r = checkAssets(files, ["x.png", "y.png", "z.png"]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.unused, ["assets/z.png"]);
});

/* ------------------------------------------------------------------ *
 * 从「这个页面」出发，引用能不能找到文件
 *
 * 这一组是针对一次真实事故补的：导出物「文件都在、页面里也都有引用」，
 * 但上传后样式丢失、返回链接 404、文章图片裂图 —— 因为同一个字符串
 * 在不同层数的页面里指向不同文件。只检查"存在"和"包含"是抓不到的。
 * ------------------------------------------------------------------ */

test("页面层数与相对前缀", () => {
  assert.equal(pageDepth("index.html"), 0);
  assert.equal(pageDepth("style.css"), 0);
  assert.equal(pageDepth("stores/x/index.html"), 2);
  assert.equal(pageDepth("knowledge/a/index.html"), 2);
  assert.equal(pageDepth("a/b/c/index.html"), 3);
  assert.equal(relativePrefix(0), "");
  assert.equal(relativePrefix(2), "../../");
});

test("引用解析：同一字符串在不同层数的页面里指向不同文件", () => {
  assert.deepEqual(resolveReference("index.html", "style.css"), { kind: "local", path: "style.css" });
  assert.deepEqual(resolveReference("stores/x/index.html", "style.css"), { kind: "local", path: "stores/x/style.css" });
  assert.deepEqual(resolveReference("stores/x/index.html", "../../style.css"), { kind: "local", path: "style.css" });
  assert.deepEqual(resolveReference("knowledge/a/index.html", "../../assets/i.png"), { kind: "local", path: "assets/i.png" });
});

test("以 / 开头的引用按站点根解析（子路径部署也不会失效）", () => {
  assert.deepEqual(resolveReference("stores/x/index.html", "/style.css"), { kind: "local", path: "style.css" });
  assert.deepEqual(resolveReference("index.html", "/assets/a.png"), { kind: "local", path: "assets/a.png" });
});

test("返回首页这类目录引用解析到根 index.html", () => {
  assert.deepEqual(resolveReference("stores/x/index.html", "../../"), { kind: "local", path: "index.html" });
  assert.deepEqual(resolveReference("stores/x/index.html", "./"), { kind: "local", path: "stores/x/index.html" });
});

test("逃出站点根目录的引用被判为错误", () => {
  assert.equal(resolveReference("index.html", "../outside.css").kind, "escape");
  assert.equal(resolveReference("a/b/index.html", "../../../x.png").kind, "escape");
});

test("外链、锚点、协议相对地址不参与站内检查", () => {
  for (const ref of ["https://x.example/a", "http://x.example/a", "//cdn.example/a", "#section", "mailto:a@b.com", "data:image/png;base64,AA"]) {
    assert.equal(resolveReference("index.html", ref).kind, "external", ref);
  }
});

/* ---------------- 三类真实事故的回归 ---------------- */

/** 按导出器的规则生成一套完整的输出文件（含 resources） */
function buildSite(): { files: ExportFile[]; indexPath: string[] } {
  const index = renderDocument({
    siteName: "站点", title: "首页", description: "说明",
    canonicalPath: "https://geo.example.com/", bodyHtml: renderIndexBody("站点", []), depth: 0,
  });
  const store = renderDocument({
    siteName: "站点", title: "门店", description: "说明",
    canonicalPath: "https://geo.example.com/stores/x/",
    bodyHtml: renderStoreBody(storeSnapshot(), 2), depth: 2,
  });
  const article = renderDocument({
    siteName: "站点", title: "文章", description: "说明",
    canonicalPath: "https://geo.example.com/knowledge/a/",
    bodyHtml: rewriteLocalRefs(markdownToHtml("![图](assets/img/store.jpg)"), 2), depth: 2,
  });
  const files: ExportFile[] = [
    { path: "index.html", content: index },
    { path: "stores/x/index.html", content: store },
    { path: "knowledge/a/index.html", content: article },
    { path: "style.css", content: EXPORT_CSS },
    { path: "assets/img/store.jpg", content: "" },
  ];
  return { files, indexPath: files.map((f) => f.path) };
}

test("回归：门店/品牌页的样式表指向两层之外（曾写成 ../style.css）", () => {
  const { files } = buildSite();
  const store = files.find((f) => f.path === "stores/x/index.html")!;
  assert.match(store.content, /<link rel="stylesheet" href="\.\.\/\.\.\/style\.css">/, "应为 ../../style.css");
});

test("回归：门店/品牌页的返回链接指向站点根（曾写成 ../ 落到空目录）", () => {
  const { files } = buildSite();
  const store = files.find((f) => f.path === "stores/x/index.html")!;
  assert.match(store.content, /class="crumb"><a href="\.\.\/\.\.\/"/, "应回到站点根");
});

test("回归：文章图片被改写成从文章页出发的相对路径（曾直接输出 assets/…）", () => {
  const { files } = buildSite();
  const article = files.find((f) => f.path === "knowledge/a/index.html")!;
  assert.match(article.content, /<img src="\.\.\/\.\.\/assets\/img\/store\.jpg"/, "应为 ../../assets/img/store.jpg");
});

test("完整导出物里没有任何失效引用（三类问题一起检查）", () => {
  const { files, indexPath } = buildSite();
  const broken = brokenReferences(files, indexPath);
  assert.deepEqual(broken.map((b) => `${b.from} ${b.kind} ${b.ref} → ${b.reason}`), []);
});

test("三类问题任一存在时都会被检查抓到（负向用例）", () => {
  const { files, indexPath } = buildSite();
  const withBugs: ExportFile[] = files.map((f) => {
    if (f.path === "stores/x/index.html") {
      return { ...f, content: f.content.replace("../../style.css", "../style.css").replace('href="../../"', 'href="../"') };
    }
    if (f.path === "knowledge/a/index.html") {
      return { ...f, content: f.content.replace("../../assets/img/store.jpg", "assets/img/store.jpg") };
    }
    return f;
  });
  const broken = brokenReferences(withBugs, indexPath);
  // 样式表、返回链接、图片各一处
  assert.equal(broken.filter((b) => b.kind === "stylesheet").length, 1, JSON.stringify(broken));
  assert.equal(broken.filter((b) => b.kind === "link").length, 1, JSON.stringify(broken));
  assert.equal(broken.filter((b) => b.kind === "image").length, 1, JSON.stringify(broken));
});

test("内容引用改写：站内按根书写转成页面相对，外链与锚点不动", () => {
  const html = `<img src="assets/a.png"><a href="/knowledge/b/">b</a><a href="https://x.example/c">c</a><a href="#top">t</a>`;
  const out = rewriteLocalRefs(html, 2);
  assert.ok(out.includes('src="../../assets/a.png"'), out);
  assert.ok(out.includes('href="../../knowledge/b/"'), out);
  assert.ok(out.includes('href="https://x.example/c"'), "外链不得改写");
  assert.ok(out.includes('href="#top"'), "锚点不得改写");
});

test("内容引用改写：逃出根目录的引用保持原样（交给引用检查报错）", () => {
  const out = rewriteLocalRefs(`<img src="../../../secret.png">`, 1);
  assert.ok(out.includes('src="../../../secret.png"'), out);
});

test("内容引用改写保留目录链接的结尾斜杠（丢斜杠会 404）", () => {
  const out = rewriteLocalRefs(`<a href="/knowledge/b/">b</a>`, 2);
  assert.ok(out.includes('href="../../knowledge/b/"'), out);
  // 且这种链接能被引用检查解析到该目录的 index.html
  assert.deepEqual(resolveReference("knowledge/a/index.html", "../../knowledge/b/"), { kind: "local", path: "knowledge/b/index.html" });
});

test("百分号编码的链接能解析到未编码的中文目录（否则非 ASCII slug 全被误报）", () => {
  const encoded = `/stores/${encodeURIComponent("海鹏菜馆-store_abc")}/`;
  assert.deepEqual(resolveReference("index.html", encoded), { kind: "local", path: "stores/海鹏菜馆-store_abc/index.html" });
  // 检查器据此判定文件存在
  const files: ExportFile[] = [
    { path: "index.html", content: `<a href="${encoded}">门店</a>` },
    { path: "stores/海鹏菜馆-store_abc/index.html", content: "<h1>门店</h1>" },
  ];
  assert.deepEqual(brokenReferences(files, files.map((f) => f.path)), []);
});

test("非法百分号编码不会让解析抛错", () => {
  assert.doesNotThrow(() => resolveReference("index.html", "/a%zz/b.html"));
  assert.deepEqual(resolveReference("index.html", "/a%zz.html"), { kind: "local", path: "a%zz.html" });
});

test("%2F 不会被当作路径分隔符（避免解码引入额外层级）", () => {
  assert.deepEqual(resolveReference("index.html", "a%2Fb.html"), { kind: "local", path: "a%2Fb.html" });
});

test("索引页的条目链接在子路径部署下也必须可用（不能是根绝对路径）", () => {
  const body = rewriteLocalRefs(renderIndexBody("站点", [{ url: "/stores/x/", title: "门店", summary: "", kind: "store" }]), 0);
  assert.ok(body.includes('href="stores/x/"'), body);
  assert.ok(!body.includes('href="/stores/x/"'), "根绝对路径在子路径部署下会 404");
  // 从索引页出发解析：仍指向同一个文件
  assert.deepEqual(resolveReference("index.html", "stores/x/"), { kind: "local", path: "stores/x/index.html" });
});

test("正文里指向站点根的链接也要改写（留在 / 会在子路径部署时跳到域名根）", () => {
  assert.ok(rewriteLocalRefs(`<a href="/">首页</a>`, 2).includes('href="../../"'), rewriteLocalRefs(`<a href="/">首页</a>`, 2));
  assert.ok(rewriteLocalRefs(`<a href="./">首页</a>`, 2).includes('href="../../"'));
  // 站点根页面保持 ./，不要变成空字符串
  assert.ok(rewriteLocalRefs(`<a href="/">首页</a>`, 0).includes('href="./"'));
});
