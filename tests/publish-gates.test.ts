import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPublishReadiness, type PublishGateFetcher } from "../src/lib/publishing.ts";

/**
 * 发布后三项门槛：页面可抓取 / robots 未拦 AI 抓取方 / 站点地图已收录。
 *
 * 这几条对应验收标准里的「发布内容必须检查页面/站点地图/可抓取性」。
 * 用注入的抓取器验证，不依赖真实网络。
 */

const PAGE_URL = "https://example.com/knowledge/geo-basics";

const longBody = `<html><head><title>GEO 基础</title>` +
  `<link rel="canonical" href="${PAGE_URL}">` +
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"GEO 基础"}</script>` +
  `</head><body><p>${"这是一段足够长的正文内容。".repeat(30)}</p></body></html>`;

function makeFetcher(files: Record<string, { ok?: boolean; status?: number; body?: string | null; error?: string }>): PublishGateFetcher {
  return async (url: string) => {
    const hit = files[url];
    if (!hit) return { ok: false, status: 404, body: null, error: "Not Found" };
    return { ok: hit.ok ?? true, status: hit.status ?? 200, body: hit.body ?? null, error: hit.error };
  };
}

test("三项全过时 ok 才为 true", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: longBody },
      "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" },
      "https://example.com/sitemap.xml": { body: `<urlset><url><loc>${PAGE_URL}</loc></url></urlset>` },
    }),
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.gates.map((g) => g.id), ["http", "readable", "canonical", "robots", "sitemap", "structuredData"]);
  assert.ok(r.gates.every((g) => g.ok));
});

test("robots.txt 拦住关键 AI 抓取方即判未通过（页面 200 也不够）", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: longBody },
      "https://example.com/robots.txt": { body: "User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /" },
      "https://example.com/sitemap.xml": { body: `<urlset><url><loc>${PAGE_URL}</loc></url></urlset>` },
    }),
  );
  const robots = r.gates.find((g) => g.id === "robots")!;
  assert.equal(robots.ok, false);
  assert.match(robots.detail, /OAI-SearchBot/);
  assert.equal(r.gates.find((g) => g.id === "http")!.ok, true, "HTTP 本身是通的");
  assert.equal(r.reachable, false, "被 robots 拦住就不算可抓取");
  assert.equal(r.ok, false);
});

test("只屏蔽纯训练爬虫（GPTBot）不算实质阻断 —— 不得误报", async () => {
  // GPTBot 只喂训练语料，不影响检索与引用。把它算成阻断会让用户
  // 去改一个不影响结果的配置，这正是本产品要避免的假警报。
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: longBody },
      "https://example.com/robots.txt": { body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /" },
      "https://example.com/sitemap.xml": { body: `<urlset><url><loc>${PAGE_URL}</loc></url></urlset>` },
    }),
  );
  assert.equal(r.gates.find((g) => g.id === "robots")!.ok, true);
  assert.equal(r.reachable, true);
  assert.equal(r.ok, true);
});

test("页面 200 但正文过短（登录墙/纯前端渲染）判未通过", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: "<html><body>Loading…</body></html>" },
      "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" },
      "https://example.com/sitemap.xml": { body: `<urlset><url><loc>${PAGE_URL}</loc></url></urlset>` },
    }),
  );
  const readable = r.gates.find((g) => g.id === "readable")!;
  assert.equal(readable.ok, false);
  assert.equal(r.gates.find((g) => g.id === "http")!.ok, true, "HTTP 本身是通的");
  assert.equal(r.ok, false);
});

test("robots.txt 缺失按全放行处理，不当作失败", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: longBody },
      "https://example.com/sitemap.xml": { body: `<urlset><url><loc>${PAGE_URL}</loc></url></urlset>` },
    }),
  );
  const robots = r.gates.find((g) => g.id === "robots")!;
  assert.equal(robots.ok, true);
  assert.match(robots.detail, /缺失按全放行/);
});

test("站点地图未收录该 URL 判未通过", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: longBody },
      "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" },
      "https://example.com/sitemap.xml": { body: "<urlset><url><loc>https://example.com/other</loc></url></urlset>" },
    }),
  );
  const sitemap = r.gates.find((g) => g.id === "sitemap")!;
  assert.equal(sitemap.ok, false);
  assert.equal(r.reachable, true, "sitemap 未收录不影响可抓取");
  assert.equal(r.discoverable, false);
  assert.equal(r.ok, false, "严格口径下未收录不算全过");
});

test("robots 里声明的 sitemap 优先于默认 /sitemap.xml", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: longBody },
      "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap-index.xml" },
      "https://example.com/sitemap-index.xml": { body: `<urlset><url><loc>${PAGE_URL}</loc></url></urlset>` },
    }),
  );
  assert.equal(r.gates.find((g) => g.id === "sitemap")!.ok, true);
  assert.equal(r.ok, true);
});

test("抓取异常不抛错，转成可读的未通过结论", async () => {
  const r = await checkPublishReadiness(PAGE_URL, async () => {
    throw new Error("连接被重置");
  });
  assert.equal(r.ok, false);
  assert.equal(r.gates[0].id, "http");
  assert.equal(r.gates[0].ok, false);
});

/* ------------------------------------------------------------------ *
 * A4 新增门槛：HTTP / 正文 / canonical / 结构化数据 分开记录
 * ------------------------------------------------------------------ */

function bodyWith(extra: { canonical?: string | null; ld?: string | null; text?: string }) {
  const ld = extra.ld === null ? "" : (extra.ld ?? `<script type="application/ld+json">{"@type":"Article"}</script>`);
  const canonical = extra.canonical === null ? "" : `<link rel="canonical" href="${extra.canonical ?? PAGE_URL}">`;
  return `<html><head><title>t</title>${canonical}${ld}</head><body><p>${extra.text ?? "这是一段足够长的正文内容。".repeat(30)}</p></body></html>`;
}

const SITEMAP_OK = { body: `<urlset><url><loc>${PAGE_URL}</loc></url></urlset>` };

test("canonical 缺失时单独判未通过，但页面仍算可抓取", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({ [PAGE_URL]: { body: bodyWith({ canonical: null }) }, "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://example.com/sitemap.xml": SITEMAP_OK }),
  );
  const g = r.gates.find((x) => x.id === "canonical")!;
  assert.equal(g.ok, false);
  assert.equal(r.reachable, true, "canonical 缺失不影响可抓取");
  assert.equal(r.wellFormed, false);
  assert.equal(r.ok, false);
});

test("canonical 指向别的页面判未通过（权重被让出去）", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({ [PAGE_URL]: { body: bodyWith({ canonical: "https://example.com/other" }) }, "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://example.com/sitemap.xml": SITEMAP_OK }),
  );
  const g = r.gates.find((x) => x.id === "canonical")!;
  assert.equal(g.ok, false);
  assert.match(g.detail, /不是本页/);
});

test("canonical 用相对路径且指向本页时通过", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({ [PAGE_URL]: { body: bodyWith({ canonical: "/knowledge/geo-basics" }) }, "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://example.com/sitemap.xml": SITEMAP_OK }),
  );
  assert.equal(r.gates.find((x) => x.id === "canonical")!.ok, true);
});

test("结构化数据缺失时单独判未通过", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({ [PAGE_URL]: { body: bodyWith({ ld: null }) }, "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://example.com/sitemap.xml": SITEMAP_OK }),
  );
  const g = r.gates.find((x) => x.id === "structuredData")!;
  assert.equal(g.ok, false);
  assert.match(g.detail, /没有 JSON-LD/);
  assert.equal(r.reachable, true);
});

test("结构化数据损坏时给出可辨别的说明", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({ [PAGE_URL]: { body: bodyWith({ ld: `<script type="application/ld+json">{bad json}</script>` }) }, "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://example.com/sitemap.xml": SITEMAP_OK }),
  );
  const g = r.gates.find((x) => x.id === "structuredData")!;
  assert.equal(g.ok, false);
  assert.match(g.detail, /无法解析/);
});

test("结构化数据列出实际类型", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({ [PAGE_URL]: { body: bodyWith({ ld: `<script type="application/ld+json">[{"@type":"Article"},{"@type":"Organization"}]</script>` }) }, "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://example.com/sitemap.xml": SITEMAP_OK }),
  );
  const g = r.gates.find((x) => x.id === "structuredData")!;
  assert.equal(g.ok, true);
  assert.match(g.detail, /Article/);
  assert.match(g.detail, /Organization/);
});

test("六项门槛各自独立：一项不过不影响其余项的结论", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: bodyWith({ canonical: "https://example.com/other", ld: null }) },
      "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" },
      "https://example.com/sitemap.xml": SITEMAP_OK,
    }),
  );
  const byId = Object.fromEntries(r.gates.map((g) => [g.id, g.ok]));
  assert.equal(byId.http, true);
  assert.equal(byId.readable, true);
  assert.equal(byId.canonical, false);
  assert.equal(byId.robots, true);
  assert.equal(byId.sitemap, true);
  assert.equal(byId.structuredData, false);
  assert.equal(r.reachable, true);
  assert.equal(r.discoverable, true);
  assert.equal(r.wellFormed, false);
  assert.equal(r.ok, false, "严格口径：只要有一项不过就不算全过");
});

test("每个门槛 id 都有对应的后果说明（不能只说失败）", async () => {
  const { GATE_CONSEQUENCE } = await import("../src/lib/publishing.ts");
  for (const id of ["http", "readable", "canonical", "robots", "sitemap", "structuredData"] as const) {
    assert.ok(GATE_CONSEQUENCE[id] && GATE_CONSEQUENCE[id].length > 4, id);
  }
});

/* ------------------------------------------------------------------ *
 * 第三态：未检查
 *
 * SSRF 防护会拒绝抓取本机/内网地址。这时"我们没查"不等于"页面有问题"——
 * 报成未通过是假阴性，会让本地开发永远是红的，久而久之没人再看这个检查。
 * ------------------------------------------------------------------ */

test("本机地址：六项门槛全部标为「未检查」而不是「未通过」", async () => {
  // 用默认抓取器：fetchPage 会在连接之前就拒绝环回地址，不会真的发请求
  const r = await checkPublishReadiness("http://127.0.0.1:3100/knowledge/x");
  assert.equal(r.gates.length, 6);
  for (const g of r.gates) {
    assert.equal(g.state, "not_checked", `${g.id} 应为未检查：${g.detail}`);
    assert.equal(g.ok, false);
    assert.match(g.detail, /SSRF|本机|内网/);
    assert.match(g.detail, /EXTRA_TRUSTED_CIDRS/);
  }
  assert.equal(r.reachable, null, "未检查时可达性必须是未知，不能是 false");
  assert.equal(r.discoverable, null);
  assert.equal(r.wellFormed, null);
  assert.equal(r.ok, false, "未检查不能算全过");
});

test("各种本机写法都被识别", async () => {
  const { isLoopbackHost } = await import("../src/lib/publishing.ts");
  for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "app.localhost"]) {
    assert.equal(isLoopbackHost(h), true, h);
  }
  for (const h of ["example.com", "localhost.example.com", "192.168.1.1"]) {
    assert.equal(isLoopbackHost(h), false, h);
  }
});

test("公网地址仍走真实检查（未检查态不能变成万能挡箭牌）", async () => {
  const r = await checkPublishReadiness(
    PAGE_URL,
    makeFetcher({
      [PAGE_URL]: { body: bodyWith({ canonical: null, ld: null }) },
      "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" },
      "https://example.com/sitemap.xml": { body: "<urlset/>" },
    }),
  );
  assert.equal(r.gates.filter((g) => g.state === "not_checked").length, 0);
  assert.equal(r.reachable, true);
  assert.equal(r.gates.find((g) => g.id === "canonical")!.state, "fail");
});
