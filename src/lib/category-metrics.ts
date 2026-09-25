/**
 * 按问题类目分开算指标（纯逻辑，可单测）。
 *
 * 方案要求分开展示三类结果：
 *   1. 认识品牌（认知题）
 *   2. 无品牌问题推荐（推荐题 + 场景题）
 *   3. 引用来源
 *
 * 为什么必须分开：认知题里出现品牌是必然的，把它和推荐题混在一起算，
 * 提及率会凭空变高，而那个数字对"能不能被推荐"毫无解释力。
 * 分开之后，认知题的数字回答的是"模型对这个品牌的描述准不准"。
 *
 * 指标计算**复用 `computeMetrics`**，不另写一套 —— 口径只能有一份，
 * 两套实现迟早会在某个边界上给出不同答案。
 */
import { computeMetrics, type CitationHit, type MentionHit, type MetricValue, type SampleForMetrics } from "./evaluation.ts";
import { QUESTION_CATEGORIES, getCategory, isQuestionCategory, type QuestionCategory } from "./protocol.ts";

export interface CategorizedSample extends SampleForMetrics {
  /** 问题类目；未分类为 null */
  category: string | null;
  /** 该样本中出现的竞品实体名（非目标品牌） */
  competitorEntities?: string[];
}

export interface CompetitorMetric {
  /** 至少提到一个竞品的样本数 / 有效样本数 */
  rate: number;
  numerator: number;
  denominator: number;
  /** 各竞品被提到的样本数，降序 */
  byEntity: Array<{ entity: string; samples: number }>;
  basis: string;
}

export interface CategoryBlock {
  category: QuestionCategory | null;
  label: string;
  /** 是否参与"能否被推荐"的判断 */
  countsTowardRecommendation: boolean;
  sampleCount: number;
  /** 有效样本的分子/分母都体现在各指标里 */
  metrics: MetricValue[];
  notComputable: Array<{ metric: string; reason: string }>;
  competitor: CompetitorMetric | null;
  /** 该块数字应该怎么读 */
  readingNote: string;
}

export interface CategoryMetricsResult {
  blocks: CategoryBlock[];
  /** 只用于"能否被推荐"的两类合起来的样本数 —— 仅作参考，不合并计算 */
  recommendationSampleCount: number;
  uncategorizedCount: number;
  notes: string[];
}

function emptyBlock(category: QuestionCategory | null, sampleCount: number): CategoryBlock {
  const meta = category ? getCategory(category) : undefined;
  return {
    category,
    label: meta?.label ?? "未分类",
    countsTowardRecommendation: meta?.countsTowardRecommendation ?? false,
    sampleCount,
    metrics: [],
    notComputable: [],
    competitor: null,
    readingNote: "",
  };
}

/** 竞品出现率 + 各竞品被提到的样本数 */
export function computeCompetitorMetric(samples: CategorizedSample[]): CompetitorMetric | null {
  const total = samples.length;
  if (total === 0) return null;
  const byEntity = new Map<string, number>();
  let hitSamples = 0;
  for (const s of samples) {
    const names = new Set<string>();
    for (const name of s.competitorEntities ?? []) {
      if (name.trim()) names.add(name.trim());
    }
    // 兜底：从 mentions 里取非目标实体
    for (const m of s.mentions) {
      if (!m.isTarget && m.entity.trim()) names.add(m.entity.trim());
    }
    if (names.size > 0) hitSamples++;
    for (const n of names) byEntity.set(n, (byEntity.get(n) ?? 0) + 1);
  }
  return {
    rate: hitSamples / total,
    numerator: hitSamples,
    denominator: total,
    byEntity: [...byEntity.entries()]
      .map(([entity, count]) => ({ entity, samples: count }))
      .sort((a, b) => b.samples - a.samples || a.entity.localeCompare(b.entity)),
    basis: `至少提到一个竞品的样本 ${hitSamples} / 有效样本 ${total}`,
  };
}

const READING_NOTE: Record<string, string> = {
  branded_awareness:
    "认知题里出现品牌是必然的，因此这一块的提及率不能用来判断能否被推荐 —— " +
    "它回答的是「模型对这个品牌的描述准不准」，重点看事实错误率。",
  unbranded_recommendation:
    "推荐题不带品牌名，最接近真实用户的提问方式。这一块才反映「能不能被推荐」。",
  comparison_scenario:
    "场景题带具体条件，用来观察模型在约束下的选择。与推荐题一起构成推荐类结论。",
  uncategorized: "有样本的问题还没分类，因此没有归入任何一块统计。",
};

/**
 * 按类目分组计算。
 *
 * 未分类的样本单独成块，**不并入任何一类** —— 把它们随手塞进推荐题会
 * 让推荐类的分母虚高、比率虚低，而且没人看得出来。
 */
export function computeMetricsByCategory(samples: CategorizedSample[]): CategoryMetricsResult {
  const groups = new Map<string, CategorizedSample[]>();
  for (const s of samples) {
    const key = isQuestionCategory(s.category) ? s.category : "__uncategorized__";
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const order: Array<QuestionCategory | "__uncategorized__"> = [
    ...QUESTION_CATEGORIES.map((c) => c.value),
    "__uncategorized__",
  ];

  const blocks: CategoryBlock[] = [];
  for (const key of order) {
    const list = groups.get(key);
    if (!list || list.length === 0) continue;
    const category = key === "__uncategorized__" ? null : (key as QuestionCategory);
    const block = emptyBlock(category, list.length);
    const { metrics, notComputable } = computeMetrics(list.map((s) => ({ sampleId: s.sampleId, mentions: s.mentions, citations: s.citations })));
    block.metrics = metrics;
    block.notComputable = notComputable;
    block.competitor = computeCompetitorMetric(list);
    block.readingNote = READING_NOTE[key] ?? "";
    blocks.push(block);
  }

  const recommendationSampleCount = samples.filter(
    (s) => isQuestionCategory(s.category) && getCategory(s.category)?.countsTowardRecommendation,
  ).length;
  const uncategorizedCount = samples.filter((s) => !isQuestionCategory(s.category)).length;

  const notes: string[] = [];
  if (uncategorizedCount > 0) {
    notes.push(`${uncategorizedCount} 条样本的问题还没有分类，未并入任何一块统计`);
  }
  if (recommendationSampleCount === 0 && samples.length > 0) {
    notes.push("没有任何推荐题/场景题样本 —— 无法判断「能否被推荐」");
  }
  const competitorTotal = blocks.reduce((n, b) => n + (b.competitor?.numerator ?? 0), 0);
  if (samples.length > 0 && competitorTotal === 0) {
    notes.push("所有样本里都没有出现被跟踪的竞品 —— 若无竞品数据，请在品牌页补充竞品清单");
  }

  return { blocks, recommendationSampleCount, uncategorizedCount, notes };
}

/* ------------------------------------------------------------------ *
 * 引用来源单独成块
 * ------------------------------------------------------------------ */

export interface CitationSourceBlock {
  /** 自有来源被引用的样本数 / 有效样本数 */
  ownedRate: number;
  ownedNumerator: number;
  denominator: number;
  /** 引用到的域名排行（自有优先） */
  byDomain: Array<{ domain: string; owned: boolean; samples: number }>;
  basis: string;
}

/**
 * 引用来源块。
 *
 * 与"认识品牌""无品牌推荐"并列，而不是混进提及率里：
 * 被提及和被引用是两件事 —— 模型可能提到你，但引用别人的页面解释你。
 */
export function computeCitationSourceBlock(samples: Array<{ citations: CitationHit[] }>): CitationSourceBlock {
  const total = samples.length;
  const byDomain = new Map<string, { owned: boolean; samples: number }>();
  let ownedSamples = 0;
  for (const s of samples) {
    let hasOwned = false;
    const seen = new Set<string>();
    for (const c of s.citations) {
      if (!c.domain || seen.has(c.domain)) continue;
      seen.add(c.domain);
      const prev = byDomain.get(c.domain);
      byDomain.set(c.domain, { owned: prev?.owned || c.owned, samples: (prev?.samples ?? 0) + 1 });
      if (c.owned) hasOwned = true;
    }
    if (hasOwned) ownedSamples++;
  }
  return {
    ownedRate: total === 0 ? 0 : ownedSamples / total,
    ownedNumerator: ownedSamples,
    denominator: total,
    byDomain: [...byDomain.entries()]
      .map(([domain, v]) => ({ domain, ...v }))
      .sort((a, b) => Number(b.owned) - Number(a.owned) || b.samples - a.samples || a.domain.localeCompare(b.domain)),
    basis: `引用了自有来源的样本 ${ownedSamples} / 有效样本 ${total}`,
  };
}
