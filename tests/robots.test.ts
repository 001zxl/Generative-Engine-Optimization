/**
 * robots.txt 解析与匹配的单元测试。
 *
 * 运行：pnpm test
 * （robots.ts 没有任何 import，因此可以直接用 node 的类型剥离能力跑，不需要额外依赖）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseRobots, isAllowed } from "../src/lib/net/robots.ts";

const TYPICAL = `# 典型站点配置
User-agent: *
Disallow: /admin/
Allow: /
Crawl-delay: 2

User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Disallow: /blog/

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news-sitemap.xml
`;

test("解析：分组、规则与 Sitemap", () => {
  const p = parseRobots(TYPICAL);
  assert.equal(p.groups.length, 4, "应解析出 4 个 user-agent 组");
  assert.deepEqual(p.groups[0].agents, ["*"]);
  assert.equal(p.groups[0].crawlDelay, 2);
  assert.deepEqual(p.groups[1].agents, ["gptbot"]);
  assert.equal(p.groups[1].rules[0].type, "disallow");
  assert.deepEqual(p.sitemaps, ["https://example.com/sitemap.xml", "https://example.com/news-sitemap.xml"]);
});

test("精确 token 组覆盖通配组", () => {
  const p = parseRobots(TYPICAL);
  // GPTBot 有自己的组，应使用自己的规则（Disallow: /），而不是 * 组的 Allow: /
  assert.equal(isAllowed(p, "GPTBot", "/blog/post").allowed, false);
  assert.equal(isAllowed(p, "GPTBot", "/blog/post").matchedAgent, "gptbot");
  assert.equal(isAllowed(p, "OAI-SearchBot", "/blog/post").allowed, true);
});

test("回退到通配组，并正确应用 Allow 覆盖 Disallow", () => {
  const p = parseRobots(TYPICAL);
  assert.equal(isAllowed(p, "Googlebot", "/blog/post").allowed, true, "/blog/post 命中 Allow: /");
  assert.equal(isAllowed(p, "Googlebot", "/admin/users").allowed, false, "/admin/users 命中更长的 Disallow: /admin/");
});

test("未列出该 token 且无通配组时默认允许", () => {
  const p = parseRobots("User-agent: GPTBot\nDisallow: /\n");
  assert.equal(isAllowed(p, "PerplexityBot", "/anything").allowed, true);
});

test("没有 robots.txt 时一律允许", () => {
  const p = parseRobots(null, "404");
  assert.equal(isAllowed(p, "OAI-SearchBot", "/").allowed, true);
  assert.equal(p.error, "404");
});

test("空的 Disallow 表示全部允许（但分组仍应被统计）", () => {
  const p = parseRobots("User-agent: *\nDisallow:\n");
  assert.equal(p.groups.length, 1, "应保留该 user-agent 组");
  assert.equal(p.groups[0].rules.length, 0, "空 Disallow 不产生规则");
  assert.equal(isAllowed(p, "AnyBot", "/x").allowed, true);
});

test("通配符 * 与结尾锚定 $", () => {
  const p = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /private*/\nAllow: /private/public/\n");
  assert.equal(isAllowed(p, "Googlebot", "/docs/a.pdf").allowed, false, "/*.pdf$ 命中");
  assert.equal(isAllowed(p, "Googlebot", "/docs/a.pdf?x=1").allowed, true, "$ 锚定结尾，带参数不命中");
  assert.equal(isAllowed(p, "Googlebot", "/private/x/y").allowed, false, "/private*/ 命中");
  assert.equal(isAllowed(p, "Googlebot", "/private/public/z").allowed, true, "Allow 更长，优先");
});

test("最长匹配优先；同长度时 Allow 优先", () => {
  const p = parseRobots("User-agent: *\nDisallow: /a/\nAllow: /a/b/\n");
  assert.equal(isAllowed(p, "X", "/a/b/c").allowed, true, "更长的 Allow 胜出");
  assert.equal(isAllowed(p, "X", "/a/z").allowed, false, "只命中 Disallow");

  const tie = parseRobots("User-agent: *\nDisallow: /same\nAllow: /same\n");
  assert.equal(isAllowed(tie, "X", "/same/page").allowed, true, "同长度时 Allow 优先");
});

test("多个同名 token 组会被合并（真实站点常见）", () => {
  const p = parseRobots("User-agent: Googlebot\nDisallow: /a/\n\nUser-agent: Googlebot\nDisallow: /b/\n");
  assert.equal(isAllowed(p, "Googlebot", "/a/x").allowed, false);
  assert.equal(isAllowed(p, "Googlebot", "/b/x").allowed, false);
  assert.equal(isAllowed(p, "Googlebot", "/c/x").allowed, true);
});

test("注释、空行、BOM 与大小写不敏感", () => {
  const p = parseRobots("\uFEFF# 注释\nUSER-AGENT: *   # 行内注释\nDISALLOW: /secret/\n");
  assert.deepEqual(p.groups[0].agents, ["*"]);
  assert.equal(p.groups[0].rules[0].path, "/secret/");
  assert.equal(isAllowed(p, "Anything", "/secret/x").allowed, false);
});

test("判定结果带可展示的依据文本", () => {
  const p = parseRobots(TYPICAL);
  const v = isAllowed(p, "GPTBot", "/blog/post");
  assert.match(v.reason, /Disallow: \//);
  assert.equal(v.matchedRule?.type, "disallow");
});

test("真实世界的混合配置：只拒绝训练、保留检索", () => {
  const p = parseRobots(`User-agent: GPTBot
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: CCBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Claude-SearchBot
Allow: /

User-agent: *
Allow: /
`);
  for (const token of ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot"]) {
    assert.equal(isAllowed(p, token, "/article").allowed, false, `${token} 应被阻止`);
  }
  for (const token of ["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Googlebot"]) {
    assert.equal(isAllowed(p, token, "/article").allowed, true, `${token} 应被放行`);
  }
});

/* ------------------------------------------------------------------ *
 * 站点 robots 配置回归（src/lib/robots-config.ts）
 *
 * 背景：robots.txt 的具名 user-agent 组会**覆盖** `*` 组而不是与之合并。
 * 曾经给检索型爬虫单独写了一个 `Allow: /` 组，结果 /console、/api/、/r/
 * 对 Googlebot、OAI-SearchBot 等实际是放开的。这组用例守住这件事。
 * ------------------------------------------------------------------ */

test("站点 robots：每个组（含具名爬虫组）都必须禁止运营台/API/结果页", async () => {
  const cfg = await import("../src/lib/robots-config.ts");
  const parsed = parseRobots(cfg.renderRobotsText());

  const protectedPaths = ["/console", "/console/leads", "/console/public-pages", "/api/leads", "/r/abc123"];
  for (const agent of cfg.allRobotsAgents()) {
    for (const path of protectedPaths) {
      const verdict = isAllowed(parsed, agent, path);
      assert.equal(verdict.allowed, false, `${agent} 不应被允许抓取 ${path}：${verdict.reason}`);
    }
  }
});

test("站点 robots：公开页面仍对所有爬虫放行（不能因为收紧而误伤获客页）", async () => {
  const cfg = await import("../src/lib/robots-config.ts");
  const parsed = parseRobots(cfg.renderRobotsText());
  const publicPaths = ["/", "/tools/ai-crawler-check", "/methods", "/knowledge/some-article", "/stores/x", "/brands/y"];
  for (const agent of ["*", "Googlebot", "OAI-SearchBot", "GPTBot"]) {
    for (const path of publicPaths) {
      assert.equal(isAllowed(parsed, agent, path).allowed, true, `${agent} 应能抓取 ${path}`);
    }
  }
});

test("站点 robots：三组规则的放行/禁止范围必须完全一致", async () => {
  const cfg = await import("../src/lib/robots-config.ts");
  const rules = cfg.robotsRules();
  assert.equal(rules.length, 3);
  for (const rule of rules) {
    assert.deepEqual([...rule.allow].sort(), [...cfg.ALLOWED_PATHS].sort());
    assert.deepEqual([...rule.disallow].sort(), [...cfg.DISALLOWED_PATHS].sort());
  }
});
