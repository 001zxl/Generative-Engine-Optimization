/**
 * 供报告使用的「带问题类目 + 评测结果」的样本视图。
 *
 * 只读 evaluation_results，不重算 —— 报告必须复现评测当时的结论，
 * 否则前后对比的口径会变（这是 B3 的验收要求之一）。
 */
import { getDb, workspaceId } from "./index.ts";
import type { CitationHit, MentionHit } from "../evaluation.ts";
import type { CategorizedSample } from "../category-metrics.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const all = <T>(sql: string, ...a: any[]): T[] => getDb().prepare(sql).all(...a) as unknown as T[];

export function listCategorySamples(categoryByQuestion: Map<string, string | null>): CategorizedSample[] {
  const rows = all<{ sample_id: string; question_id: string | null }>(
    "SELECT id AS sample_id, question_id FROM response_samples WHERE workspace_id = ?",
    workspaceId(),
  );
  const evaluations = all<{ sample_id: string; evaluator: string; result_json: string }>(
    "SELECT sample_id, evaluator, result_json FROM evaluation_results WHERE workspace_id = ?",
    workspaceId(),
  );

  const mentionsBySample = new Map<string, MentionHit[]>();
  const citationsBySample = new Map<string, CitationHit[]>();
  for (const e of evaluations) {
    try {
      if (e.evaluator === "mentions") mentionsBySample.set(e.sample_id, JSON.parse(e.result_json) as MentionHit[]);
      if (e.evaluator === "citations") citationsBySample.set(e.sample_id, JSON.parse(e.result_json) as CitationHit[]);
    } catch {
      // 坏 JSON 视为该样本没有对应评测结果 —— 宁可少算，不能把解析失败当数据
    }
  }

  return rows
    // 只保留已评测的样本：未评测的样本没有 mentions/citations，计入分母会低估比率
    .filter((r) => mentionsBySample.has(r.sample_id) || citationsBySample.has(r.sample_id))
    .map((r) => ({
      sampleId: r.sample_id,
      category: r.question_id ? (categoryByQuestion.get(r.question_id) ?? null) : null,
      mentions: mentionsBySample.get(r.sample_id) ?? [],
      citations: citationsBySample.get(r.sample_id) ?? [],
    }));
}
