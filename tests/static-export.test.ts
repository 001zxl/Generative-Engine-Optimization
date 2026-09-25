import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAssets,
  normalizeExportBaseUrl,
  referencedAssets,
  renderDocument,
  renderIndexBody,
  renderRobots,
  renderSitemap,
  renderStoreBody,
  scanExportSafety,
  siteUrl,
  type ExportFile,
} from "../src/lib/static-export.ts";
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
    { path: "index.html", content: renderDocument({ siteName: "站点", title: "首页", description: "说明", canonicalPath: "https://geo.example.com/", bodyHtml: "<h1>首页</h1>", assetPrefix: "" }) },
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
  const html = renderDocument({ siteName: "站点", title: "标题", description: "描述", canonicalPath: "https://x.example.com/a/", bodyHtml: "<p>正文</p>", assetPrefix: "../" });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>标题<\/title>/);
  assert.match(html, /<meta name="description" content="描述">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.example\.com\/a\/">/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/style\.css">/);
});

test("标题与描述里的 HTML 被转义", () => {
  const html = renderDocument({ siteName: "s", title: `<script>alert(1)</script>`, description: `"quoted"`, canonicalPath: "/", bodyHtml: "", assetPrefix: "" });
  assert.ok(!html.includes("<script>alert"), html);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;quoted&quot;/);
});

test("JSON-LD 里的 < 被转义，防止提前闭合 script", () => {
  const html = renderDocument({ siteName: "s", title: "t", description: "d", canonicalPath: "/", bodyHtml: "", assetPrefix: "", jsonLd: { name: "</script><script>alert(1)</script>" } });
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

test("取出被引用的站内资源，忽略外链", () => {
  const files: ExportFile[] = [
    { path: "a.html", content: `<img src="/assets/x.png"><img src="https://cdn.example/y.png"><img src="assets/z.jpg">` },
  ];
  assert.deepEqual(referencedAssets(files).sort(), ["assets/x.png", "assets/z.jpg"]);
});

test("被引用但不存在的资源判为缺失（上传后是裂图）", () => {
  const files: ExportFile[] = [{ path: "a.html", content: `<img src="/assets/x.png">` }];
  const r = checkAssets(files, ["other.png"]);
  assert.deepEqual(r.missing, ["assets/x.png"]);
  assert.deepEqual(r.unused, ["other.png"]);
});

test("资源齐全时既不缺失也不多余", () => {
  const files: ExportFile[] = [{ path: "a.html", content: `<img src="/assets/x.png">` }];
  const r = checkAssets(files, ["assets/x.png"]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.unused, []);
});
