/**
 * 评估编排：把一批样本转成评估结果与指标快照。
 *
 * 为什么从 Server Action 里抽出来：
 *   原先这段逻辑直接写在 app/console/actions.ts 的 evaluateRun() 内，
 *   而 Server Action 无法被单测覆盖 —— 结果就是一个「runId 为空时写入不存在的
 *   外键 "manual"」的缺陷躲过了所有测试，直到真实使用才以 HTTP 500 暴露。
 *   抽成普通函数后，这个分支可以被集成测试直接打到。
 */
import * as R from "./db/repo-domains.ts";
import * as PC from "./db/repo-protocol.ts";
import { computeMetricsByCategory, type CategorizedSample } from "./category-metrics.ts";
import {
  extractFromAnswer,
  computeMetrics,
  checkFactConsistency,
  type EntityRef,
  type SampleForMetrics,
} from "./evaluation.ts";

export interface EvaluateScope {
  /** 目标批次；null 表示跨批次的「全部样本」范围 */
  runId: string | null;
  brandId: string;
  /** 跨批次时的样本上限，避免一次跑爆 */
  allScopeLimit?: number;
}

export interface EvaluateResult {
  ok: boolean;
  reason?: string;
  scope: "run" | "all_recent";
  samples: number;
  metrics: Array<{ metric: string; value: number; numerator: number; denominator: number }>;
  notComputable: Array<{ metric: string; reason: string }>;
  /** 按问题类目分开的结果（方案要求三类分开展示） */
  byCategory?: Array<{
    category: string | null;
    label: string;
    sampleCount: number;
    countsTowardRecommendation: boolean;
    metrics: Array<{ metric: string; value: number; numerator: number; denominator: number }>;
    competitor: { numerator: number; denominator: number; byEntity: Array<{ entity: string; samples: number }> } | null;
  }>;
  notes?: string[];
}

export const MANUAL_EVALUATOR_VERSION = "1.0.0";

export function evaluateScope(input: EvaluateScope): EvaluateResult {
  const brandId = input.brandId || R.getDefaultBrandId() || "";
  const ctx = brandId ? R.getBrandContext(brandId) : null;
  if (!ctx) {
    return { ok: false, reason: "未找到品牌实体，无法确定「什么算提到了我们」", scope: "run", samples: 0, metrics: [], notComputable: [] };
  }

  const scope: "run" | "all_recent" = input.runId ? "run" : "all_recent";
  const samples = input.runId
    ? R.listSamples(input.runId)
    : R.listSamples().slice(0, input.allScopeLimit ?? 200);

  if (samples.length === 0) {
    return {
      ok: false,
      reason: input.runId ? "该批次还没有任何样本" : "还没有任何样本",
      scope,
      samples: 0,
      metrics: [],
      notComputable: [],
    };
  }

  const entities: EntityRef[] = ctx.entities;
  const claims = R.getApprovedClaims();
  const forMetrics: SampleForMetrics[] = [];

  for (const sample of samples) {
    const extracted = extractFromAnswer(sample.raw_answer, entities, ctx.ownedDomains);

    R.saveEvaluation({
      sampleId: sample.id,
      evaluator: "mentions",
      version: MANUAL_EVALUATOR_VERSION,
      result: extracted.mentions,
      confidence: extracted.mentions.length > 0 ? 0.8 : 1,
    });
    R.saveEvaluation({
      sampleId: sample.id,
      evaluator: "citations",
      version: MANUAL_EVALUATOR_VERSION,
      result: extracted.citations,
      confidence: 0.9,
    });

    if (claims.length > 0) {
      const facts = checkFactConsistency(sample.raw_answer, claims);
      const hasConflict = facts.some((f) => f.verdict === "conflict");
      R.saveEvaluation({
        sampleId: sample.id,
        evaluator: "facts",
        version: MANUAL_EVALUATOR_VERSION,
        result: facts,
        confidence: facts.length ? Math.min(...facts.map((f) => f.confidence)) : 0.2,
        // 事实判定是启发式 —— 只要出现冲突或无法判断就进人工复核，不直接当结论
        needsReview: hasConflict || facts.some((f) => f.verdict === "unknown"),
      });
    }

    forMetrics.push({ sampleId: sample.id, mentions: extracted.mentions, citations: extracted.citations });
  }

  const { metrics, notComputable } = computeMetrics(forMetrics);
  for (const m of metrics) {
    R.saveMetricSnapshot({
      // 关键：跨批次范围传 null，而不是编造一个不存在的 run id。
      // metric_snapshots.run_id 是指向 sampling_runs 的外键，写 "manual" 会直接
      // 触发 FOREIGN KEY constraint failed（这正是被修掉的缺陷）。
      runId: input.runId,
      metric: m.metric,
      value: m.value,
      numerator: m.numerator,
      denominator: m.denominator,
      dimension: {
        basis: m.basis,
        sampleCount: forMetrics.length,
        scope,
        // 跨批次时必须记下范围，否则快照无法解释
        engines: [...new Set(samples.map((s) => s.engine))],
      },
    });
  }

  // —— 按问题类目分别落库 ——
  // 认知题里出现品牌是必然的，与推荐题混算会把提及率做高，而那个数字
  // 对"能不能被推荐"没有解释力。因此每个类目单独存一份快照，
  // 报告与复测对比都按同一维度取数。
  const categoryMap = PC.categoryByQuestionId();
  const categorized: CategorizedSample[] = forMetrics.map((m) => {
    const sample = samples.find((s) => s.id === m.sampleId);
    return {
      ...m,
      category: sample?.question_id ? (categoryMap.get(sample.question_id) ?? null) : null,
    };
  });
  const byCategory = computeMetricsByCategory(categorized);
  for (const block of byCategory.blocks) {
    for (const m of block.metrics) {
      R.saveMetricSnapshot({
        runId: input.runId,
        metric: m.metric,
        value: m.value,
        numerator: m.numerator,
        denominator: m.denominator,
        dimension: {
          basis: m.basis,
          scope,
          // 类目是取数维度：报告按它分块，复测对比也只在同类目内进行
          category: block.category ?? "uncategorized",
          sampleCount: block.sampleCount,
          countsTowardRecommendation: block.countsTowardRecommendation,
        },
      });
    }
    if (block.competitor) {
      R.saveMetricSnapshot({
        runId: input.runId,
        metric: "competitor_mention_rate",
        value: block.competitor.rate,
        numerator: block.competitor.numerator,
        denominator: block.competitor.denominator,
        dimension: {
          basis: block.competitor.basis,
          scope,
          category: block.category ?? "uncategorized",
          byEntity: block.competitor.byEntity,
          sampleCount: block.sampleCount,
        },
      });
    }
  }

  return {
    ok: true,
    scope,
    samples: samples.length,
    byCategory: byCategory.blocks.map((b) => ({
      category: b.category,
      label: b.label,
      sampleCount: b.sampleCount,
      countsTowardRecommendation: b.countsTowardRecommendation,
      metrics: b.metrics.map((m) => ({ metric: m.metric, numerator: m.numerator, denominator: m.denominator, value: m.value })),
      competitor: b.competitor ? { numerator: b.competitor.numerator, denominator: b.competitor.denominator, byEntity: b.competitor.byEntity } : null,
    })),
    notes: byCategory.notes,
    metrics: metrics.map((m) => ({
      metric: m.metric,
      value: m.value,
      numerator: m.numerator,
      denominator: m.denominator,
    })),
    notComputable,
  };
}
