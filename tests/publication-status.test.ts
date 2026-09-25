import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicationStatus,
  matchCitation,
  normalizeForCompare,
  type CitationEvidence,
  type PublicationStatusInput,
} from "../src/lib/publication-status.ts";
import { GATE_CONSEQUENCE } from "../src/lib/publishing.ts";

/**
 * 四项状态分开呈现。
 *
 * 最要紧的不是"能显示通过"，而是**不该断言时必须是未知**：
 * 我们无法知道搜索引擎收录情况，也不能因为"发了内容"就说"被 AI 引用"。
 */

const URL_X = "https://example.com/knowledge/geo";

function gates(allPass = true) {
  return [
    { id: "http", label: "HTTP 可访问", ok: true, detail: "HTTP 200" },
    { id: "readable", label: "正文可读", ok: true, detail: "正文约 2000 字" },
    { id: "canonical", label: "canonical 指向本页", ok: allPass, detail: allPass ? "指向本页" : "未声明 canonical" },
    { id: "robots", label: "robots.txt 未拦截 AI 抓取方", ok: true, detail: "全部放行" },
    { id: "sitemap", label: "站点地图已收录该 URL", ok: allPass, detail: allPass ? "已收录" : "未收录" },
    { id: "structuredData", label: "含可解析的结构化数据", ok: allPass, detail: allPass ? "Article" : "没有 JSON-LD" },
  ];
}

function input(over: Partial<PublicationStatusInput> = {}): PublicationStatusInput {
  return {
    url: URL_X,
    publishedAt: "2026-09-25T10:00:00Z",
    channel: "own_site",
    gates: gates(),
    reachable: true,
    checkedAt: "2026-09-25T10:05:00Z",
    citations: [],
    evaluatedSampleCount: 0,
    ...over,
  };
}

/* ---------------- 已发布 ---------------- */

test("有发布记录时「已发布」为是，并给出渠道与时间", () => {
  const s = buildPublicationStatus(input());
  assert.equal(s.published.state, "yes");
  assert.match(s.published.evidence, /本站知识页/);
  assert.match(s.published.evidence, /2026-09-25/);
});

test("没有 URL 时「已发布」为否，且说明后续三项无从谈起", () => {
  const s = buildPublicationStatus(input({ url: null, publishedAt: null }));
  assert.equal(s.published.state, "no");
  assert.match(s.published.evidence, /无从谈起/);
});

/* ---------------- 可抓取 ---------------- */

test("门槛全过时「可抓取」为是，并列出通过了哪些项", () => {
  const s = buildPublicationStatus(input());
  assert.equal(s.crawlable.state, "yes");
  assert.match(s.crawlable.evidence, /HTTP 可访问/);
});

test("未跑过检查时「可抓取」为未知（不能默认成可抓取）", () => {
  const s = buildPublicationStatus(input({ gates: [], reachable: null, checkedAt: null }));
  assert.equal(s.crawlable.state, "unknown");
  assert.match(s.crawlable.evidence, /还没有执行/);
});

test("被 robots 拦住时「可抓取」为否，并带出具体门槛与原因", () => {
  const g = gates().map((x) => (x.id === "robots" ? { ...x, ok: false, detail: "被拦截：OAI-SearchBot" } : x));
  const s = buildPublicationStatus(input({ gates: g, reachable: false }));
  assert.equal(s.crawlable.state, "no");
  assert.match(s.crawlable.evidence, /OAI-SearchBot/);
});

/* ---------------- 已收录：必须永远是未知 ---------------- */

test("「已收录」永远是未知，且说明为什么不能自行断言", () => {
  const s = buildPublicationStatus(input());
  assert.equal(s.indexed.state, "unknown");
  assert.match(s.indexed.evidence, /无法自行断言/);
  assert.match(s.indexed.evidence, /不等于/);
});

test("即使全部门槛通过，也不得把「已收录」写成是", () => {
  const s = buildPublicationStatus(input());
  assert.notEqual(s.indexed.state, "yes");
});

/* ---------------- 被 AI 引用 ---------------- */

test("没有任何样本时「被 AI 引用」为未知", () => {
  const s = buildPublicationStatus(input({ evaluatedSampleCount: 0 }));
  assert.equal(s.citedByAi.state, "unknown");
  assert.match(s.citedByAi.evidence, /不采样/);
});

test("有样本但未命中引用时为未知（不是否）", () => {
  const s = buildPublicationStatus(input({ evaluatedSampleCount: 30, citations: [{ url: "https://other.com/a", domain: "other.com" }] }));
  assert.equal(s.citedByAi.state, "unknown");
  assert.match(s.citedByAi.evidence, /未观察到/);
  assert.match(s.citedByAi.evidence, /不能据此断定/);
});

test("样本里真的引用了该 URL 时才为是", () => {
  const s = buildPublicationStatus(input({ evaluatedSampleCount: 30, citations: [{ url: URL_X, domain: "example.com" }] }));
  assert.equal(s.citedByAi.state, "yes");
  assert.match(s.citedByAi.evidence, /geo/);
});

test("只有域名命中不算（首页被引用不等于这一页被引用）", () => {
  const citations: CitationEvidence[] = [{ url: "https://example.com/", domain: "example.com" }];
  assert.equal(matchCitation(URL_X, citations), undefined);
});

test("同域同路径但查询串不同算命中", () => {
  assert.ok(matchCitation(URL_X, [{ url: `${URL_X}?utm_source=x`, domain: "example.com" }]));
});

test("结尾斜杠与 hash 不影响命中判定", () => {
  assert.ok(matchCitation(URL_X, [{ url: `${URL_X}/`, domain: "example.com" }]));
  assert.ok(matchCitation(`${URL_X}#section`, [{ url: URL_X, domain: "example.com" }]));
});

test("只有域名、没有 URL 的引用记录不算命中", () => {
  assert.equal(matchCitation(URL_X, [{ url: null, domain: "example.com" }]), undefined);
});

test("归一化对非法 URL 不抛错", () => {
  assert.equal(normalizeForCompare("not a url"), "not a url");
  assert.equal(normalizeForCompare("https://example.com/a/#x"), "https://example.com/a");
});

/* ---------------- 汇总 ---------------- */

test("存在未知项时 hasUnknown 为真（界面据此提示不要当成已完成）", () => {
  assert.equal(buildPublicationStatus(input()).hasUnknown, true, "已收录恒为未知");
});

test("四项状态相互独立：可抓取不推出被引用", () => {
  const s = buildPublicationStatus(input());
  assert.equal(s.crawlable.state, "yes");
  assert.notEqual(s.citedByAi.state, "yes");
});

test("每个门槛都有后果说明，供界面解释不通过的代价", () => {
  assert.equal(Object.keys(GATE_CONSEQUENCE).length, 6);
  for (const v of Object.values(GATE_CONSEQUENCE)) assert.ok(v.length > 4);
});

test("可达性为「未检查」时状态为未知，不是否（否则本地开发永远是红的）", () => {
  const unchecked = gates().map((g) => ({ ...g, ok: false, state: "not_checked" as const, detail: "本机地址（SSRF 防护拒绝抓取本机/内网地址）" }));
  const s = buildPublicationStatus(input({ gates: unchecked, reachable: null }));
  assert.equal(s.crawlable.state, "unknown");
  assert.match(s.crawlable.evidence, /SSRF|本机/);
});

test("旧数据没有 state 字段时按 ok 推断，不误判成未检查", () => {
  const legacy = gates().map(({ id, label, ok, detail }) => ({ id, label, ok, detail }));
  const s = buildPublicationStatus(input({ gates: legacy, reachable: true }));
  assert.equal(s.crawlable.state, "yes");
});
