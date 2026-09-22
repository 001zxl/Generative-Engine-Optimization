import { createHash } from "node:crypto";
import { getDb, workspaceId, audit } from "./db/index.ts";
import { newId } from "./id.ts";
import { getBrandContext, type BrandContext } from "./db/repo-domains.ts";
import { computeMetrics, extractFromAnswer, type MetricValue } from "./evaluation.ts";

export interface ProtocolTask {
  questionId: string;
  questionText: string;
  engine: string;
  region: string;
  repetition: number;
}
export interface RunProtocol {
  querySetId: string;
  querySetVersion: number;
  brandId: string;
  samplingMode: string;
  tasks: ProtocolTask[];
}
export interface ExperimentSample {
  id: string;
  taskId: string | null;
  questionId: string | null;
  engine: string;
  mode: string;
  region: string;
  repetition: number;
  rawAnswer: string;
  collectedAt: string;
  evidenceKind: string | null;
  model: string | null;
  sourceUrl: string | null;
  providerResponseId: string | null;
  searchEnabled: number | null;
  requestConfig: unknown;
  citationUrls: string[];
}
export interface ExperimentProtocol extends RunProtocol {
  version: 1;
  evaluatorVersion: "experiment-1";
  brandContext: BrandContext;
  baselineSamples: ExperimentSample[];
  capturedAt: string;
}
export interface ExperimentRow {
  id: string;
  name: string;
  brand_id: string;
  baseline_run_id: string;
  protocol_json: string;
  intervention: string;
  published_urls_json: string;
  retest_due_at: string | null;
  created_at: string;
}
export interface ComparisonGroup {
  engine: string;
  mode: string;
  region: string;
  model: string;
  expected: number;
  before: number;
  after: number;
  beforeCoverage: number;
  afterCoverage: number;
  metrics: Array<{ metric: string; before: MetricValue | null; after: MetricValue | null; deltaPercentagePoints: number | null }>;
  notComputable: string[];
  sampleIds: { before: string[]; after: string[] };
}
export interface ExperimentComparison {
  status: "comparable" | "incomplete" | "incompatible";
  reasons: string[];
  expected: number;
  beforeValid: number;
  afterValid: number;
  excluded: Array<{ side: "before" | "after"; sampleId: string; reason: string }>;
  groups: ComparisonGroup[];
  interpretation: string;
}

const now = () => new Date().toISOString();
const parse = <T>(json: string, fallback: T): T => { try { return JSON.parse(json) as T; } catch { return fallback; } };
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const taskKey = (task: ProtocolTask) => JSON.stringify([task.questionId, task.engine, task.region, task.repetition]);
const sampleKey = (sample: ExperimentSample) => JSON.stringify([sample.questionId, sample.engine, sample.region, sample.repetition]);
const groupKey = (sample: ExperimentSample) => JSON.stringify([sample.engine, sample.mode, sample.region, sample.model]);
const protocolKey = (protocol: RunProtocol) => stable({ ...protocol, tasks: [...protocol.tasks].sort((a, b) => taskKey(a).localeCompare(taskKey(b))) });
const protocolOnly = (p: RunProtocol): RunProtocol => ({ querySetId: p.querySetId, querySetVersion: p.querySetVersion, brandId: p.brandId, samplingMode: p.samplingMode, tasks: p.tasks });

/** 原文、来源和模型都可追溯才是有效观察。夹具永远不进入效果指标。 */
function invalidSample(sample: ExperimentSample, mode: string): string | null {
  if (sample.evidenceKind === "fixture") return "测试夹具，已排除真实效果指标";
  if (!sample.rawAnswer.trim()) return "没有回答原文";
  if (sample.mode !== mode) return "采样方式与协议不一致";
  if (!sample.taskId || !sample.evidenceKind) return "缺少任务与来源追溯";
  if (!sample.model?.trim() || /^(unknown|未知|未记录)$/i.test(sample.model.trim())) return "未记录模型版本";
  if (sample.evidenceKind === "official_api") {
    if (sample.mode !== "official_api") return "官方 API 来源不能合入消费者界面采样";
    if (!sample.providerResponseId) return "缺少官方 API 响应 ID";
  } else if (sample.evidenceKind === "manual_ui") {
    if (sample.mode === "official_api") return "消费者界面来源不能合入官方 API 采样";
    // 无引用的回答也必须进入分母；不提供分享链接的平台允许人工登记来源，标为自报。
    if (sample.sourceUrl) {
      try { if (!["https:", "http:"].includes(new URL(sample.sourceUrl).protocol)) return "回答来源 URL 无效"; } catch { return "回答来源 URL 无效"; }
    }
  } else return "不受支持或缺失的来源类型";
  if (!Number.isFinite(Date.parse(sample.collectedAt))) return "采集时间无效";
  return null;
}

/** 纯函数：测试用的合成回答仅在 tests 里构造，不写入业务库。 */
export function compareExperimentData(input: {
  protocol: RunProtocol;
  baselineProtocol: RunProtocol;
  retestProtocol: RunProtocol;
  baselineSamples: ExperimentSample[];
  retestSamples: ExperimentSample[];
  brandContext: BrandContext;
}): ExperimentComparison {
  const { protocol } = input;
  const reasons: string[] = [];
  let incompatible = false;
  if (protocolKey(protocolOnly(input.baselineProtocol)) !== protocolKey(protocolOnly(protocol)) || protocolKey(protocolOnly(input.retestProtocol)) !== protocolKey(protocolOnly(protocol))) {
    reasons.push("品牌、冻结问题版本、问题原文、引擎、地区、重复次数或采样方式与锁定协议不一致");
    incompatible = true;
  }
  if (input.brandContext.brandId !== protocol.brandId) { reasons.push("品牌匹配口径与实验品牌不一致"); incompatible = true; }
  const expectedKeys = new Set(protocol.tasks.map(taskKey));
  if (!expectedKeys.size || expectedKeys.size !== protocol.tasks.length) { reasons.push("协议任务为空或重复"); incompatible = true; }
  const excluded: ExperimentComparison["excluded"] = [];
  function select(samples: ExperimentSample[], side: "before" | "after") {
    const bySlot = new Map<string, ExperimentSample[]>();
    for (const sample of samples) {
      const key = sampleKey(sample);
      const invalid = invalidSample(sample, protocol.samplingMode);
      if (!expectedKeys.has(key) || invalid) {
        excluded.push({ side, sampleId: sample.id, reason: invalid ?? "回答不属于协议内的任务" });
        if (!expectedKeys.has(key) || sample.mode !== protocol.samplingMode) incompatible = true;
        continue;
      }
      bySlot.set(key, [...(bySlot.get(key) ?? []), sample]);
    }
    const valid = new Map<string, ExperimentSample>();
    for (const [key, samplesInSlot] of bySlot) {
      if (samplesInSlot.length !== 1) {
        for (const sample of samplesInSlot) excluded.push({ side, sampleId: sample.id, reason: "同一任务存在多条回答，不能选择性取样" });
        incompatible = true;
      } else valid.set(key, samplesInSlot[0]);
    }
    return valid;
  }
  const before = select(input.baselineSamples, "before");
  const after = select(input.retestSamples, "after");
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) continue;
    if (b.model !== a.model) { reasons.push(`模型不同：${b.engine} ${b.model} → ${a.model}`); incompatible = true; }
    if (b.searchEnabled !== a.searchEnabled || stable(b.requestConfig) !== stable(a.requestConfig)) {
      reasons.push(`${b.engine} 的联网开关或请求参数不同`); incompatible = true;
    }
    if (Date.parse(a.collectedAt) <= Date.parse(b.collectedAt)) {
      reasons.push("复测采集时间必须晚于对应基线回答"); incompatible = true;
    }
  }
  const incomplete = before.size !== expectedKeys.size || after.size !== expectedKeys.size || excluded.length > 0;
  if (incomplete) reasons.push(`有效覆盖未完成：基线 ${before.size}/${expectedKeys.size}，复测 ${after.size}/${expectedKeys.size}；排除 ${excluded.length} 条回答`);
  const repetitions = new Map<string, Set<number>>();
  for (const task of protocol.tasks) {
    const key = JSON.stringify([task.questionId, task.engine, task.region]);
    const reps = repetitions.get(key) ?? new Set<number>();
    reps.add(task.repetition); repetitions.set(key, reps);
  }
  const limited = [...repetitions.values()].some((reps) => reps.size < 3);
  if (limited) reasons.push("低样本量：部分问题每个引擎/地区少于 3 次；差值仅是本次描述性观察，不具备统计显著性证据");
  if ([...before.values(), ...after.values()].some((s) => s.evidenceKind === "manual_ui" && !s.sourceUrl)) reasons.push("含未提供分享链接的人工界面来源登记，真实性由采样人员自报，建议保留平台截图或内部凭证供复核");
  const status: ExperimentComparison["status"] = incompatible ? "incompatible" : incomplete ? "incomplete" : "comparable";
  const groupKeys = new Set([...before.values(), ...after.values()].map(groupKey));
  const groups = [...groupKeys].map((key): ComparisonGroup => {
    const b = [...before.values()].filter((s) => groupKey(s) === key);
    const a = [...after.values()].filter((s) => groupKey(s) === key);
    const exemplar = b[0] ?? a[0];
    // 每个模型分组的分母以基线该模型占据的固定任务槽为准，不借用另一模型的结果。
    const bKeys = new Set(b.map(sampleKey));
    const expected = b.length || protocol.tasks.filter((t) => t.engine === exemplar.engine && t.region === exemplar.region).length;
    const groupAfter = a.filter((s) => bKeys.has(sampleKey(s)));
    const metricInput = (samples: ExperimentSample[]) => samples.map((sample) => ({
      sampleId: sample.id,
      mentions: extractFromAnswer(sample.rawAnswer, input.brandContext.entities, input.brandContext.ownedDomains).mentions,
      citations: extractFromAnswer([sample.rawAnswer, ...sample.citationUrls].join("\n"), [], input.brandContext.ownedDomains).citations,
    }));
    const bm = computeMetrics(metricInput(b));
    const am = computeMetrics(metricInput(a));
    const names = ["mention_rate", "top1_rate", "sov", "owned_citation_rate"];
    return {
      engine: exemplar.engine, mode: exemplar.mode, region: exemplar.region, model: exemplar.model ?? "未知",
      expected, before: b.length, after: a.length,
      beforeCoverage: expected ? b.length / expected : 0, afterCoverage: expected ? groupAfter.length / expected : 0,
      metrics: names.map((metric) => {
        const beforeMetric = bm.metrics.find((m) => m.metric === metric) ?? null;
        const afterMetric = am.metrics.find((m) => m.metric === metric) ?? null;
        return { metric, before: beforeMetric, after: afterMetric, deltaPercentagePoints: status === "comparable" && beforeMetric && afterMetric ? (afterMetric.value - beforeMetric.value) * 100 : null };
      }),
      notComputable: [...bm.notComputable.map((m) => `基线 ${m.metric}：${m.reason}`), ...am.notComputable.map((m) => `复测 ${m.metric}：${m.reason}`)],
      sampleIds: { before: b.map((s) => s.id), after: a.map((s) => s.id) },
    };
  });
  return {
    status, reasons: [...new Set(reasons)], expected: expectedKeys.size, beforeValid: before.size, afterValid: after.size, excluded, groups,
    interpretation: status === "comparable"
      ? "仅报告该固定问题集、模型、地区与采样方式下的观测变化。未控制模型随机性、索引更新及其他推广活动，不能据此断言推广导致提升，也不代表整个市场曝光率。"
      : "当前不满足同协议、完整且可追溯的真实样本条件，未生成曝光提升结论或百分点差值。",
  };
}

export function readRunProtocol(runId: string): RunProtocol {
  const db = getDb();
  const row = db.prepare(`SELECT r.query_set_id, r.sampling_mode, qs.brand_id, qs.version, qs.status
    FROM sampling_runs r JOIN query_sets qs ON qs.id = r.query_set_id
    WHERE r.id = ? AND r.workspace_id = ? AND qs.workspace_id = ?`).get(runId, workspaceId(), workspaceId()) as { query_set_id: string; sampling_mode: string; brand_id: string | null; version: number; status: string } | undefined;
  if (!row || !row.brand_id) throw new Error("采样批次必须属于当前工作区内已绑定品牌的问题集");
  if (row.status !== "frozen") throw new Error("必须先冻结问题集才能建立或比较实验");
  const tasks = db.prepare(`SELECT question_id AS questionId, question_text AS questionText, engine,
    COALESCE(region, '') AS region, repetition FROM sampling_tasks WHERE run_id = ? AND workspace_id = ? ORDER BY question_id, engine, region, repetition`).all(runId, workspaceId()) as unknown as ProtocolTask[];
  if (!tasks.length) throw new Error("采样批次没有任务，不能作为基线");
  const questions = db.prepare("SELECT id, text FROM questions WHERE query_set_id = ? AND workspace_id = ?").all(row.query_set_id, workspaceId()) as unknown as Array<{ id: string; text: string }>;
  if (questions.some((q) => !tasks.some((t) => t.questionId === q.id)) || tasks.some((t) => !questions.some((q) => q.id === t.questionId && q.text === t.questionText))) throw new Error("任务与冻结问题集的原文或覆盖不一致");
  return { querySetId: row.query_set_id, querySetVersion: row.version, brandId: row.brand_id, samplingMode: row.sampling_mode, tasks };
}

export function readExperimentSamples(runId: string): ExperimentSample[] {
  const rows = getDb().prepare(`SELECT s.*, p.task_id, p.evidence_kind, p.model_version, p.source_url,
      p.provider_response_id, p.search_enabled, p.request_config_json, p.citations_json
    FROM response_samples s LEFT JOIN sample_provenance p ON p.sample_id = s.id
    WHERE s.run_id = ? AND s.workspace_id = ? ORDER BY s.collected_at, s.id`).all(runId, workspaceId()) as unknown as Array<{
      id: string; task_id: string | null; question_id: string | null; engine: string; sampling_mode: string; region: string | null;
      repetition: number; raw_answer: string; collected_at: string; evidence_kind: string | null; model_version: string | null;
      source_url: string | null; provider_response_id: string | null; search_enabled: number | null; request_config_json: string | null; citations_json: string | null;
    }>;
  return rows.map((r) => ({
    id: r.id, taskId: r.task_id, questionId: r.question_id, engine: r.engine, mode: r.sampling_mode,
    region: r.region ?? "", repetition: r.repetition, rawAnswer: r.raw_answer, collectedAt: r.collected_at,
    evidenceKind: r.evidence_kind, model: r.model_version, sourceUrl: r.source_url, providerResponseId: r.provider_response_id,
    searchEnabled: r.search_enabled, requestConfig: parse(r.request_config_json ?? "{}", {}),
    citationUrls: parse<unknown[]>(r.citations_json ?? "[]", []).flatMap((v) => typeof v === "string" ? [v] : v && typeof v === "object" && "url" in v && typeof v.url === "string" ? [v.url] : []),
  }));
}

export function listExperiments(): ExperimentRow[] {
  return getDb().prepare("SELECT * FROM geo_experiments WHERE workspace_id = ? ORDER BY created_at DESC").all(workspaceId()) as unknown as ExperimentRow[];
}
export function getExperiment(id: string): ExperimentRow | null {
  return (getDb().prepare("SELECT * FROM geo_experiments WHERE id = ? AND workspace_id = ?").get(id, workspaceId()) as unknown as ExperimentRow | undefined) ?? null;
}
export function listRetests(experimentId: string): Array<{ run_id: string; label: string; created_at: string }> {
  return getDb().prepare(`SELECT er.run_id, r.label, er.created_at FROM experiment_retests er
    JOIN geo_experiments e ON e.id = er.experiment_id JOIN sampling_runs r ON r.id = er.run_id
    WHERE e.id = ? AND e.workspace_id = ? ORDER BY er.created_at DESC`).all(experimentId, workspaceId()) as unknown as Array<{ run_id: string; label: string; created_at: string }>;
}
function validateNotes(input: { intervention?: string; publishedUrls?: string[]; retestDueAt?: string }) {
  const urls = [...new Set((input.publishedUrls ?? []).map((url) => url.trim()).filter(Boolean))];
  if (urls.length > 100) throw new Error("发布 URL 最多 100 条");
  for (const url of urls) {
    let valid = false;
    try { const parsed = new URL(url); valid = ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { /* validated below */ }
    if (!valid) throw new Error("发布 URL 必须为不含口令的 HTTP(S) 地址");
  }
  if (input.retestDueAt && !Number.isFinite(Date.parse(input.retestDueAt))) throw new Error("复测日期无效");
  if ((input.intervention ?? "").length > 20000) throw new Error("干预记录不能超过 20000 字");
  return { intervention: input.intervention?.trim() ?? "", urls, dueAt: input.retestDueAt || null };
}

export function createExperiment(input: { name: string; baselineRunId: string; brandId: string; intervention?: string; publishedUrls?: string[]; retestDueAt?: string }): string {
  if (!input.name.trim() || input.name.length > 200) throw new Error("请输入 1–200 字的实验名称");
  const protocol = readRunProtocol(input.baselineRunId);
  if (protocol.brandId !== input.brandId) throw new Error("基线问题集与所选品牌不一致");
  const context = getBrandContext(input.brandId);
  if (!context) throw new Error("品牌不存在");
  const samples = readExperimentSamples(input.baselineRunId);
  const seen = new Set<string>();
  const expected = new Set(protocol.tasks.map(taskKey));
  for (const sample of samples) {
    const invalid = invalidSample(sample, protocol.samplingMode);
    if (invalid) throw new Error(`无法锁定基线：${invalid}（${sample.id}）`);
    const key = sampleKey(sample);
    if (!expected.has(key) || seen.has(key)) throw new Error("基线存在协议外回答或重复回答");
    seen.add(key);
  }
  if (seen.size !== expected.size) throw new Error(`真实基线未采齐：${seen.size}/${expected.size}，请先完成采样`);
  const notes = validateNotes(input);
  const t = now();
  const snapshot: ExperimentProtocol = { ...protocol, version: 1, evaluatorVersion: "experiment-1", brandContext: context, baselineSamples: samples, capturedAt: t };
  const id = newId("exp");
  getDb().prepare(`INSERT INTO geo_experiments (id, workspace_id, brand_id, name, baseline_run_id, protocol_json,
    intervention, published_urls_json, retest_due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, workspaceId(), input.brandId, input.name.trim(), input.baselineRunId, JSON.stringify(snapshot), notes.intervention, JSON.stringify(notes.urls), notes.dueAt, t, t);
  audit("lock_baseline", "geo_experiment", id, { baselineRunId: input.baselineRunId, samples: samples.length, protocolHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") });
  return id;
}

export function updateExperimentNotes(id: string, input: { intervention?: string; publishedUrls?: string[]; retestDueAt?: string }): void {
  if (!getExperiment(id)) throw new Error("实验不存在");
  const notes = validateNotes(input);
  getDb().prepare("UPDATE geo_experiments SET intervention = ?, published_urls_json = ?, retest_due_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .run(notes.intervention, JSON.stringify(notes.urls), notes.dueAt, now(), id, workspaceId());
  audit("update_intervention", "geo_experiment", id, { urls: notes.urls, retestDueAt: notes.dueAt });
}

/** 逐任务复制，避免重建笛卡尔积时改变地区/重复次数，并保留协议原文。 */
export function createExperimentRetest(id: string): string {
  const experiment = getExperiment(id);
  if (!experiment) throw new Error("实验不存在");
  const protocol = JSON.parse(experiment.protocol_json) as ExperimentProtocol;
  const current = readRunProtocol(experiment.baseline_run_id);
  if (protocolKey(protocolOnly(current)) !== protocolKey(protocolOnly(protocol))) throw new Error("基线问题或任务已偏离锁定协议，请修复后再生成复测");
  const db = getDb();
  const runId = newId("run_s");
  const t = now();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO sampling_runs (id, workspace_id, query_set_id, label, sampling_mode, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)")
      .run(runId, workspaceId(), protocol.querySetId, `${experiment.name} · 复测 ${listRetests(id).length + 1}`, protocol.samplingMode, t);
    const stmt = db.prepare(`INSERT INTO sampling_tasks (id, workspace_id, run_id, question_id, question_text, engine, region, repetition, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`);
    for (const task of protocol.tasks) stmt.run(newId("task"), workspaceId(), runId, task.questionId, task.questionText, task.engine, task.region || null, task.repetition, `${runId}|${taskKey(task)}`, t);
    db.prepare("INSERT INTO experiment_retests (experiment_id, run_id, created_at) VALUES (?, ?, ?)").run(id, runId, t);
    audit("create_retest", "geo_experiment", id, { runId, tasks: protocol.tasks.length });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return runId;
}

export function compareExperiment(id: string, retestRunId?: string): { experiment: ExperimentRow; protocol: ExperimentProtocol; runId: string | null; comparison: ExperimentComparison | null; retestSamples: ExperimentSample[] } {
  const experiment = getExperiment(id);
  if (!experiment) throw new Error("实验不存在");
  const protocol = JSON.parse(experiment.protocol_json) as ExperimentProtocol;
  const retests = listRetests(id);
  const selected = retestRunId ? retests.find((r) => r.run_id === retestRunId) : retests[0];
  if (retestRunId && !selected) throw new Error("所选复测不属于该实验");
  if (!selected) return { experiment, protocol, runId: null, comparison: null, retestSamples: [] };
  const retestSamples = readExperimentSamples(selected.run_id);
  const comparison = compareExperimentData({ protocol, baselineProtocol: protocol, retestProtocol: readRunProtocol(selected.run_id), baselineSamples: protocol.baselineSamples, retestSamples, brandContext: protocol.brandContext });
  return { experiment, protocol, runId: selected.run_id, comparison, retestSamples };
}
