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

const longBody = `<html><head><title>GEO 基础</title></head><body><p>${"这是一段足够长的正文内容。".repeat(30)}</p></body></html>`;

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
  assert.deepEqual(r.gates.map((g) => g.id), ["page", "robots", "sitemap"]);
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
  const page = r.gates.find((g) => g.id === "page")!;
  assert.equal(page.ok, false);
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
  assert.equal(r.ok, false);
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
  assert.equal(r.gates[0].ok, false);
});
