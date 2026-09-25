import { test } from "node:test";
import assert from "node:assert/strict";
import type { MentionHit } from "../src/lib/evaluation.ts";
import {
  computeCitationSourceBlock,
  computeCompetitorMetric,
  computeMetricsByCategory,
  type CategorizedSample,
} from "../src/lib/category-metrics.ts";

/**
 * 按类目分开算指标。
 *
 * 最要紧的一条：**认知题不能和推荐题混在一起算**。
 * 认知题里出现品牌是必然的，混算会把提及率做高，而那个数字对
 * "能不能被推荐"毫无解释力。
 */

/** 构造一个完整的 MentionHit（缺字段会让夹具与真实结构脱节） */
function hit(entity: string, isTarget: boolean, listRank: number | null = null): MentionHit {
  return { entity, isTarget, matchedText: entity, position: 0, inList: listRank !== null, listRank, snippet: entity, sentiment: "neutral", confidence: 1 };
}

function sample(over: Partial<CategorizedSample> = {}): CategorizedSample {
  return {
    sampleId: over.sampleId ?? Math.random().toString(36).slice(2),
    category: "unbranded_recommendation",
    mentions: [],
    citations: [],
    ...over,
  };
}

/** 目标品牌被提及的样本 */
function mentioned(category: string | null, rank: number | null = null): CategorizedSample {
  return sample({
    category,
    mentions: [hit("目标品牌", true, rank)],
  });
}

/** 未提及的样本 */
function notMentioned(category: string | null): CategorizedSample {
  return sample({ category, mentions: [] });
}

/* ---------------- 分组 ---------------- */

test("三类各自成块，未分类单独成块且不并入任何一类", () => {
  const r = computeMetricsByCategory([
    mentioned("branded_awareness"),
    mentioned("unbranded_recommendation"),
    mentioned("comparison_scenario"),
    mentioned(null),
    mentioned(null),
  ]);
  assert.deepEqual(
    r.blocks.map((b) => b.category),
    ["branded_awareness", "unbranded_recommendation", "comparison_scenario", null],
  );
  const uncategorized = r.blocks.find((b) => b.category === null)!;
  assert.equal(uncategorized.sampleCount, 2);
  assert.equal(r.uncategorizedCount, 2);
  assert.ok(r.notes.some((n) => n.includes("未并入任何一块")));
});

test("块顺序固定：认知 → 推荐 → 场景 → 未分类", () => {
  const r = computeMetricsByCategory([mentioned("comparison_scenario"), mentioned("branded_awareness")]);
  assert.deepEqual(r.blocks.map((b) => b.category), ["branded_awareness", "comparison_scenario"]);
});

test("只统计出现过的类目，空类目不生成空块", () => {
  const r = computeMetricsByCategory([mentioned("unbranded_recommendation")]);
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].category, "unbranded_recommendation");
});

/* ---------------- 指标口径 ---------------- */

test("推荐类样本数只算推荐题与场景题（认知题不计入）", () => {
  const r = computeMetricsByCategory([
    mentioned("branded_awareness"),
    mentioned("unbranded_recommendation"),
    notMentioned("unbranded_recommendation"),
    mentioned("comparison_scenario"),
  ]);
  assert.equal(r.recommendationSampleCount, 3, "推荐题 2 + 场景题 1，认知题不算");
});

test("每块都给出分子与分母，不是只有一个比率", () => {
  const r = computeMetricsByCategory([
    mentioned("unbranded_recommendation"),
    notMentioned("unbranded_recommendation"),
    notMentioned("unbranded_recommendation"),
  ]);
  const block = r.blocks[0];
  const mention = block.metrics.find((m) => m.metric === "mention_rate")!;
  assert.equal(mention.numerator, 1);
  assert.equal(mention.denominator, 3);
  assert.ok(Math.abs(mention.value - 1 / 3) < 1e-9);
  assert.ok(mention.basis.includes("1"), mention.basis);
});

test("认知题与推荐题的提及率分别计算，不会互相拉动", () => {
  const r = computeMetricsByCategory([
    // 认知题 5 条全部提及
    ...Array.from({ length: 5 }, () => mentioned("branded_awareness")),
    // 推荐题 5 条全部未提及
    ...Array.from({ length: 5 }, () => notMentioned("unbranded_recommendation")),
  ]);
  const branded = r.blocks.find((b) => b.category === "branded_awareness")!;
  const unbranded = r.blocks.find((b) => b.category === "unbranded_recommendation")!;
  assert.equal(branded.metrics.find((m) => m.metric === "mention_rate")!.value, 1);
  assert.equal(unbranded.metrics.find((m) => m.metric === "mention_rate")!.value, 0);
  // 混算会得到 50%，掩盖"推荐题一条都没提"
  assert.notEqual(branded.metrics[0].value, unbranded.metrics[0].value);
});

test("首位率只在可判断排名的样本里算", () => {
  const r = computeMetricsByCategory([
    mentioned("unbranded_recommendation", 1),
    mentioned("unbranded_recommendation", 3),
    notMentioned("unbranded_recommendation"),
  ]);
  const top1 = r.blocks[0].metrics.find((m) => m.metric === "top1_rate")!;
  assert.equal(top1.numerator, 1);
  assert.equal(top1.denominator, 2, "只有 2 条能判断排名");
});

test("没有列表形式时首位率标记为不可计算，而不是 0", () => {
  const r = computeMetricsByCategory([mentioned("unbranded_recommendation")]);
  assert.ok(r.blocks[0].notComputable.some((n) => n.metric === "top1_rate"));
  assert.equal(r.blocks[0].metrics.find((m) => m.metric === "top1_rate"), undefined);
});

test("每块给出该怎么读的说明（认知题要特别提示）", () => {
  const r = computeMetricsByCategory([mentioned("branded_awareness"), mentioned("unbranded_recommendation")]);
  const branded = r.blocks.find((b) => b.category === "branded_awareness")!;
  assert.equal(branded.countsTowardRecommendation, false);
  assert.match(branded.readingNote, /不能用来判断能否被推荐/);
  const unbranded = r.blocks.find((b) => b.category === "unbranded_recommendation")!;
  assert.equal(unbranded.countsTowardRecommendation, true);
});

/* ---------------- 竞品 ---------------- */

test("竞品出现率给出分子分母与各竞品样本数", () => {
  const r = computeMetricsByCategory([
    sample({ competitorEntities: ["竞品甲"] }),
    sample({ competitorEntities: ["竞品甲", "竞品乙"] }),
    notMentioned("unbranded_recommendation"),
  ]);
  const c = r.blocks[0].competitor!;
  assert.equal(c.numerator, 2);
  assert.equal(c.denominator, 3);
  assert.deepEqual(c.byEntity, [
    { entity: "竞品甲", samples: 2 },
    { entity: "竞品乙", samples: 1 },
  ]);
  assert.ok(c.basis.includes("2"));
});

test("竞品可从 mentions 里兜底识别（非目标实体）", () => {
  const s = sample({
    mentions: [hit("竞品丙", false)],
  });
  const c = computeCompetitorMetric([s])!;
  assert.equal(c.numerator, 1);
  assert.equal(c.byEntity[0].entity, "竞品丙");
});

test("同一竞品重复出现只算一次样本", () => {
  const s = sample({
    mentions: [hit("竞品甲", false), { ...hit("竞品甲", false), position: 50 }],
  });
  const c = computeCompetitorMetric([s])!;
  assert.equal(c.numerator, 1);
  assert.equal(c.byEntity[0].samples, 1);
});

test("一条竞品都没有时给出提示（可能是竞品清单没配）", () => {
  const r = computeMetricsByCategory([mentioned("unbranded_recommendation"), notMentioned("unbranded_recommendation")]);
  assert.ok(r.notes.some((n) => n.includes("竞品")), JSON.stringify(r.notes));
});

/* ---------------- 引用来源 ---------------- */

test("引用来源独立成块：自有来源引用率带分子分母", () => {
  const block = computeCitationSourceBlock([
    { citations: [{ url: "https://ours.example/a", domain: "ours.example", owned: true, position: 0 }] },
    { citations: [{ url: "https://other.example/b", domain: "other.example", owned: false, position: 0 }] },
  ]);
  assert.equal(block.ownedNumerator, 1);
  assert.equal(block.denominator, 2);
  assert.equal(block.ownedRate, 0.5);
  assert.equal(block.byDomain[0].domain, "ours.example", "自有域名排在前");
  assert.ok(block.byDomain[0].owned);
});

test("同一域名在多条样本里分别计数", () => {
  const block = computeCitationSourceBlock([
    { citations: [{ url: "https://a.example/1", domain: "a.example", owned: false, position: 0 }] },
    { citations: [{ url: "https://a.example/2", domain: "a.example", owned: false, position: 0 }] },
  ]);
  assert.equal(block.byDomain[0].samples, 2);
  assert.equal(block.ownedNumerator, 0);
});

test("没有引用时的引用块不会除零", () => {
  const block = computeCitationSourceBlock([{ citations: [] }, { citations: [] }]);
  assert.equal(block.denominator, 2);
  assert.equal(block.ownedRate, 0);
  assert.deepEqual(block.byDomain, []);
});

test("完全没有样本时不产生任何块", () => {
  const r = computeMetricsByCategory([]);
  assert.deepEqual(r.blocks, []);
  assert.equal(r.recommendationSampleCount, 0);
  assert.deepEqual(r.notes, []);
});
