/**
 * AI 爬虫名册的不变量测试。
 *
 * 这些断言的存在理由很具体：最初的名册是欧美中心的，漏掉了 QwenBot，
 * 也把 Baiduspider / 搜狗 / 神马这些"国内平台的真实检索通道"排除在 AI 名册之外。
 * 用户一眼就看出来了。下面的测试把"不能再漏"这件事固化下来。
 *
 * 运行：pnpm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_BOTS,
  CRITICAL_BOTS,
  PHANTOM_BOTS,
  CHINA_AI_MECHANISM,
  EVIDENCE_LABEL,
  ROSTER_UPDATED_AT,
  type BotEvidence,
} from "../src/lib/checks/bots.ts";

const VALID_EVIDENCE: BotEvidence[] = ["vendor", "observed", "reported"];

test("token 唯一（大小写不敏感）", () => {
  const seen = new Map<string, number>();
  for (const b of AI_BOTS) {
    const k = b.token.toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dupes, [], `存在重复 token：${dupes.join(", ")}`);
});

test("每条都有合法的证据等级与非空说明", () => {
  for (const b of AI_BOTS) {
    assert.ok(VALID_EVIDENCE.includes(b.evidence), `${b.token} 证据等级非法：${b.evidence}`);
    assert.ok(b.note.length > 10, `${b.token} 的说明过短`);
    assert.ok(EVIDENCE_LABEL[b.evidence], `${b.token} 缺少证据等级文案`);
  }
});

test("证据不足（reported）的条目绝不参与严重级别判定", () => {
  for (const b of AI_BOTS.filter((x) => x.evidence === "reported")) {
    assert.equal(b.impactsAiAnswers, false, `${b.token} 证据不足却声明会影响 AI 答案可见性`);
  }
  for (const b of CRITICAL_BOTS) {
    assert.notEqual(b.evidence, "reported", `CRITICAL_BOTS 不应包含证据不足的 ${b.token}`);
    assert.equal(b.impactsAiAnswers, true);
  }
});

test("训练型爬虫不应被判定为影响 AI 答案可见性", () => {
  for (const b of AI_BOTS.filter((x) => x.purpose === "training")) {
    assert.equal(b.impactsAiAnswers, false, `${b.token} 是训练型，不应标记为影响答案可见性`);
  }
});

test("虚构 token 不得同时出现在真实名册里（否则自相矛盾）", () => {
  const real = new Set(AI_BOTS.map((b) => b.token.toLowerCase()));
  for (const p of PHANTOM_BOTS) {
    for (const t of p.token.split("/").map((s) => s.trim().toLowerCase())) {
      if (!t) continue;
      assert.equal(real.has(t), false, `${p.token} 既被列为虚构 token，又出现在真实名册中`);
    }
  }
});

test("国内平台覆盖：必须包含各搜索索引通道与厂商自有爬虫（回归）", () => {
  const tokens = new Set(AI_BOTS.map((b) => b.token));
  // 这些是「国内 AI 可见性」的实际杠杆点，缺一不可
  for (const required of ["Baiduspider", "Baiduspider-render", "Sogou web spider", "YisouSpider", "QwenBot", "ChatGLM-Spider", "Bytespider"]) {
    assert.ok(tokens.has(required), `名册缺少国内通道 ${required}`);
  }
  const cn = AI_BOTS.filter((b) => b.region === "cn");
  assert.ok(cn.length >= 8, `国内条目过少：${cn.length}`);
  // 每个国内条目都应说明它服务于哪些 AI 产品，便于客户理解机制
  for (const b of cn.filter((x) => x.evidence !== "reported")) {
    assert.ok(
      (b.alsoPowers?.length ?? 0) > 0,
      `${b.token} 未标注它服务于哪些 AI 产品（这是回答"为什么找不到豆包爬虫"的关键信息）`,
    );
  }
});

test("国内机制表覆盖用户最常问到的平台", () => {
  const products = CHINA_AI_MECHANISM.map((m) => m.product).join(" ");
  for (const p of ["豆包", "文心", "元宝", "夸克"]) {
    assert.ok(products.includes(p), `机制表缺少 ${p}`);
  }
  for (const m of CHINA_AI_MECHANISM) {
    assert.ok(m.lever.length > 0 && m.detail.length > 0, `${m.product} 的机制说明不完整`);
  }
});

test("关键爬虫必须标注它服务于哪些 AI 产品", () => {
  for (const token of ["OAI-SearchBot", "PerplexityBot", "Googlebot", "Bingbot", "QwenBot"]) {
    const b = AI_BOTS.find((x) => x.token === token);
    assert.ok(b, `缺少 ${token}`);
    // OAI-SearchBot / PerplexityBot 自身即产品，故仅要求搜索索引型有映射
    if (["Googlebot", "Bingbot", "QwenBot"].includes(token)) {
      assert.ok((b.alsoPowers?.length ?? 0) > 0, `${token} 缺少 alsoPowers`);
    }
  }
});

/* =========================================================================
 * 一手来源（sourceUrl / sourceTitle / verifiedAt）
 *
 * 这些断言的理由：名册的价值在于"客户能自己复核"。一条无法点回来源的结论，
 * 与一条抄来的结论没有区别。因此来源不是可选字段。
 * ========================================================================= */

test("每条都必须带可点击的一手来源与核对日期", () => {
  for (const b of AI_BOTS) {
    assert.ok(b.sourceUrl?.startsWith("https://"), `${b.token} 的 sourceUrl 缺失或非 https`);
    assert.ok(b.sourceTitle?.length > 4, `${b.token} 的 sourceTitle 缺失`);
    assert.match(b.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${b.token} 的 verifiedAt 格式应为 YYYY-MM-DD`);
  }
});

test("证据等级必须与来源匹配（不允许张冠李戴）", () => {
  for (const b of AI_BOTS) {
    const host = new URL(b.sourceUrl).hostname;
    if (b.evidence === "vendor") {
      assert.ok(
        !host.includes("knownagents.com") && !host.includes("github.com"),
        `${b.token} 标为「官方文档」，来源却是第三方：${host}`,
      );
    }
    if (b.evidence === "observed") {
      assert.ok(
        host.includes("knownagents.com"),
        `${b.token} 标为「实测观测」，来源应为实测库而非 ${host}`,
      );
    }
    if (b.evidence === "reported") {
      assert.ok(
        host.includes("github.com"),
        `${b.token} 标为「社区清单」，来源应为社区模板而非 ${host}`,
      );
    }
  }
});

test("虚构 token 条目必须提供可核验的入口", () => {
  for (const p of PHANTOM_BOTS) {
    assert.ok(p.verifyUrl?.startsWith("https://"), `${p.token} 缺少 verifyUrl`);
    assert.ok(p.reality.length > 20, `${p.token} 的说明过短`);
  }
});

test("名册的 verifiedAt 不应晚于名册核对日期", () => {
  for (const b of AI_BOTS) {
    assert.ok(b.verifiedAt <= ROSTER_UPDATED_AT, `${b.token} 的 verifiedAt 晚于名册核对日期`);
  }
});
