/**
 * 业务域仓储层：模块 1–7 的全部数据访问。
 *
 * 与 repo.ts（工具/线索/统计）分开，避免单个文件过长；两者共用同一套约定：
 *  - 所有 SQL 集中在此，将来切 PostgreSQL 只需替换这一层
 *  - 所有写入带 workspace_id 隔离
 *  - 状态流转类写入记录审计或历史表
 */
import { getDb, workspaceId, audit } from "./index.ts";
import { newId } from "../id.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const all = <T>(sql: string, ...a: any[]): T[] => getDb().prepare(sql).all(...a) as unknown as T[];
const one = <T>(sql: string, ...a: any[]): T | undefined =>
  getDb().prepare(sql).get(...a) as unknown as T | undefined;
const run = (sql: string, ...a: any[]) => getDb().prepare(sql).run(...a);
const now = () => new Date().toISOString();

/* =====================================================================
 * 模块 1：品牌、别名、竞品
 * ===================================================================== */

export interface BrandRow {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  status: string;
  alias_count: number;
  competitor_count: number;
  created_at: string;
}

export function listBrands(): BrandRow[] {
  return all<BrandRow>(
    `SELECT b.*,
       (SELECT COUNT(*) FROM brand_aliases a WHERE a.brand_id = b.id) AS alias_count,
       (SELECT COUNT(*) FROM competitors c WHERE c.brand_id = b.id) AS competitor_count
     FROM brands b WHERE b.workspace_id = ? ORDER BY b.created_at DESC`,
    workspaceId(),
  );
}

export function createBrand(input: { name: string; domain?: string; description?: string }): string {
  const id = newId("brand");
  const t = now();
  run(
    `INSERT INTO brands (id, workspace_id, name, domain, description, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', '{}', ?, ?)`,
    id,
    workspaceId(),
    input.name,
    input.domain ?? null,
    input.description ?? null,
    t,
    t,
  );
  audit("create", "brand", id, { name: input.name });
  return id;
}

export function updateBrand(id: string, input: { name?: string; domain?: string; description?: string }): void {
  const cur = one<{ name: string; domain: string | null; description: string | null }>(
    "SELECT name, domain, description FROM brands WHERE id = ? AND workspace_id = ?",
    id,
    workspaceId(),
  );
  if (!cur) return;
  run(
    "UPDATE brands SET name = ?, domain = ?, description = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    input.name ?? cur.name,
    input.domain ?? cur.domain,
    input.description ?? cur.description,
    now(),
    id,
    workspaceId(),
  );
  audit("update", "brand", id, input);
}

export function deleteBrand(id: string): void {
  run("DELETE FROM brands WHERE id = ? AND workspace_id = ?", id, workspaceId());
  audit("delete", "brand", id);
}

export interface AliasRow {
  id: string;
  brand_id: string;
  alias: string;
  kind: string;
}

export function listAliases(brandId: string): AliasRow[] {
  return all<AliasRow>("SELECT * FROM brand_aliases WHERE brand_id = ? ORDER BY created_at", brandId);
}

export function addAlias(brandId: string, alias: string, kind = "alias"): void {
  const v = alias.trim();
  if (!v) return;
  run("INSERT INTO brand_aliases (id, brand_id, alias, kind, created_at) VALUES (?, ?, ?, ?, ?)", newId("al"), brandId, v, kind, now());
}

export function removeAlias(id: string): void {
  run("DELETE FROM brand_aliases WHERE id = ?", id);
}

export interface CompetitorRow {
  id: string;
  brand_id: string | null;
  name: string;
  domain: string | null;
}

export function listCompetitors(brandId: string): CompetitorRow[] {
  return all<CompetitorRow>("SELECT * FROM competitors WHERE brand_id = ? ORDER BY created_at", brandId);
}

export function addCompetitor(brandId: string, name: string, domain?: string): void {
  const v = name.trim();
  if (!v) return;
  run(
    "INSERT INTO competitors (id, workspace_id, brand_id, name, domain, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId("cmp"),
    workspaceId(),
    brandId,
    v,
    domain?.trim() || null,
    now(),
  );
}

export function removeCompetitor(id: string): void {
  run("DELETE FROM competitors WHERE id = ?", id);
}

/** 评估引擎需要的上下文：规范名 + 别名 + 自有域 + 竞品 */
export interface BrandContext {
  brandId: string;
  brandName: string;
  entities: Array<{ name: string; aliases: string[]; isTarget: boolean }>;
  ownedDomains: string[];
}

export function getBrandContext(brandId: string): BrandContext | null {
  const b = one<{ id: string; name: string; domain: string | null }>(
    "SELECT id, name, domain FROM brands WHERE id = ? AND workspace_id = ?",
    brandId,
    workspaceId(),
  );
  if (!b) return null;
  const aliases = listAliases(brandId).map((a) => a.alias);
  const comps = listCompetitors(brandId);
  const entityIds = [b.id, ...comps.map((c) => c.id)];

  // 竞品的别名存在 brand_aliases 之外的简单做法：竞品表本身只有 name/domain
  const entities = [
    { name: b.name, aliases, isTarget: true },
    ...comps.map((c) => ({ name: c.name, aliases: [] as string[], isTarget: false })),
  ];
  void entityIds;

  const ownedDomains = [b.domain, ...comps.map((c) => c.domain)]
    .filter((d): d is string => !!d)
    .slice(0, 1); // 只有目标品牌自己的域名算「自有域」

  return { brandId, brandName: b.name, entities, ownedDomains };
}

/** 取第一个品牌作为当前工作品牌（单品牌工作区下的便捷入口） */
export function getDefaultBrandId(): string | null {
  return one<{ id: string }>("SELECT id FROM brands WHERE workspace_id = ? ORDER BY created_at LIMIT 1", workspaceId())?.id ?? null;
}

/* =====================================================================
 * 模块 2：问题库
 * ===================================================================== */

export interface QuerySetRow {
  id: string;
  name: string;
  version: number;
  status: string;
  frozen_at: string | null;
  question_count: number;
  created_at: string;
}

export function listQuerySets(): QuerySetRow[] {
  return all<QuerySetRow>(
    `SELECT qs.*, (SELECT COUNT(*) FROM questions q WHERE q.query_set_id = qs.id) AS question_count
     FROM query_sets qs WHERE qs.workspace_id = ? ORDER BY qs.created_at DESC`,
    workspaceId(),
  );
}

export function createQuerySet(name: string, brandId?: string | null): string {
  const id = newId("qs");
  const t = now();
  run(
    `INSERT INTO query_sets (id, workspace_id, brand_id, name, version, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'draft', ?, ?)`,
    id,
    workspaceId(),
    brandId ?? getDefaultBrandId(),
    name,
    t,
    t,
  );
  audit("create", "query_set", id, { name });
  return id;
}

/**
 * 冻结问题集。冻结后问题不可直接编辑，只能新建版本 ——
 * 这是让「可见度变化」可被证明的前提：没有固定问题集，复测就没有可比性。
 */
export function freezeQuerySet(id: string): { ok: boolean; reason?: string } {
  const qs = one<{ status: string; question_count: number }>(
    `SELECT qs.status, (SELECT COUNT(*) FROM questions q WHERE q.query_set_id = qs.id) AS question_count
     FROM query_sets qs WHERE qs.id = ? AND qs.workspace_id = ?`,
    id,
    workspaceId(),
  );
  if (!qs) return { ok: false, reason: "问题集不存在" };
  if (qs.question_count === 0) return { ok: false, reason: "问题集为空，无法冻结" };
  if (qs.status === "frozen") return { ok: false, reason: "该版本已冻结" };
  run("UPDATE query_sets SET status = 'frozen', frozen_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?", now(), now(), id, workspaceId());
  audit("freeze", "query_set", id, { questionCount: qs.question_count });
  return { ok: true };
}

export function isQuerySetFrozen(id: string): boolean {
  return one<{ status: string }>("SELECT status FROM query_sets WHERE id = ?", id)?.status === "frozen";
}

export interface QuestionRow {
  id: string;
  query_set_id: string | null;
  text: string;
  persona: string | null;
  intent: string | null;
  funnel_stage: string | null;
  locale: string;
  status: string;
  created_at: string;
}

export function listQuestions(querySetId?: string): QuestionRow[] {
  if (querySetId) {
    return all<QuestionRow>("SELECT * FROM questions WHERE query_set_id = ? ORDER BY created_at", querySetId);
  }
  return all<QuestionRow>("SELECT * FROM questions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 500", workspaceId());
}

/**
 * 批量添加问题（每行一条）。
 *
 * 去重是**跨批次**的：既去掉本批次内的重复行，也跳过该问题集里已存在的同文本问题。
 * 早先版本只做批内去重，导致同一问题集里能出现重复问题 —— 那会让采样任务翻倍、
 * 指标分母虚高。冻结的版本直接拒绝写入。
 */
export function addQuestions(
  querySetId: string,
  lines: string[],
  meta: { persona?: string; intent?: string; funnelStage?: string; locale?: string } = {},
): { added: number; skippedFrozen: boolean; skippedDuplicate: number } {
  if (isQuerySetFrozen(querySetId)) return { added: 0, skippedFrozen: true, skippedDuplicate: 0 };

  const existing = new Set(
    all<{ text: string }>("SELECT text FROM questions WHERE query_set_id = ?", querySetId).map((r) => r.text.trim()),
  );
  const seen = new Set<string>();
  const texts: string[] = [];
  let skippedDuplicate = 0;
  for (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;
    if (existing.has(text) || seen.has(text)) {
      skippedDuplicate++;
      continue;
    }
    seen.add(text);
    texts.push(text);
  }

  const stmt = getDb().prepare(
    `INSERT INTO questions (id, workspace_id, query_set_id, text, persona, intent, funnel_stage, locale, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  );
  const t = now();
  for (const text of texts) {
    stmt.run(
      newId("q"),
      workspaceId(),
      querySetId,
      text,
      meta.persona ?? null,
      meta.intent ?? null,
      meta.funnelStage ?? null,
      meta.locale ?? "zh-CN",
      t,
      t,
    );
  }
  audit("import", "questions", querySetId, { added: texts.length, skippedDuplicate });
  return { added: texts.length, skippedFrozen: false, skippedDuplicate };
}

export function deleteQuestion(id: string): { ok: boolean; reason?: string } {
  const q = one<{ query_set_id: string | null }>("SELECT query_set_id FROM questions WHERE id = ? AND workspace_id = ?", id, workspaceId());
  if (!q) return { ok: false, reason: "问题不存在" };
  if (q.query_set_id && isQuerySetFrozen(q.query_set_id)) {
    return { ok: false, reason: "所属问题集已冻结，只能新建版本后再改" };
  }
  run("DELETE FROM questions WHERE id = ? AND workspace_id = ?", id, workspaceId());
  return { ok: true };
}

export function listPersonas(): Array<{ id: string; name: string; description: string | null }> {
  return all("SELECT id, name, description FROM personas WHERE workspace_id = ? ORDER BY created_at", workspaceId());
}

export function createPersona(name: string, description?: string): void {
  run(
    "INSERT INTO personas (id, workspace_id, brand_id, name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId("per"),
    workspaceId(),
    getDefaultBrandId(),
    name,
    description ?? null,
    now(),
  );
}

/* =====================================================================
 * 模块 3：品牌事实与证据
 * ===================================================================== */

export interface ClaimRow {
  id: string;
  claim_key: string;
  statement: string;
  category: string | null;
  status: string;
  valid_until: string | null;
  evidence_count: number;
  created_at: string;
}

export function listClaims(): ClaimRow[] {
  return all<ClaimRow>(
    `SELECT c.*, (SELECT COUNT(*) FROM evidences e WHERE e.claim_id = c.id) AS evidence_count
     FROM claims c WHERE c.workspace_id = ? ORDER BY c.created_at DESC`,
    workspaceId(),
  );
}

export function createClaim(input: {
  claimKey: string;
  statement: string;
  category?: string;
  validUntil?: string;
  expectedNumber?: { value: number; unit?: string };
}): string {
  const id = newId("claim");
  const t = now();
  run(
    `INSERT INTO claims (id, workspace_id, brand_id, claim_key, statement, category, status, valid_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    id,
    workspaceId(),
    getDefaultBrandId(),
    input.claimKey,
    input.statement,
    input.category ?? null,
    input.validUntil ?? null,
    t,
    t,
  );
  run(
    "INSERT INTO claim_versions (id, claim_id, version, statement, changed_by, note, created_at) VALUES (?, ?, 1, ?, 'operator', '创建', ?)",
    newId("cv"),
    id,
    input.statement,
    t,
  );
  // 可选的数值化期望值存进 metadata 需要扩展列；这里用 claim_key 约定 + 解析语句中的数字
  audit("create", "claim", id, { claimKey: input.claimKey });
  return id;
}

export function reviewClaim(id: string, decision: "approved" | "rejected", note?: string): void {
  run(
    "UPDATE claims SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    decision === "approved" ? "approved" : "rejected",
    now(),
    id,
    workspaceId(),
  );
  run(
    "INSERT INTO review_decisions (id, workspace_id, entity, entity_id, decision, actor, note, decided_at) VALUES (?, ?, 'claim', ?, ?, 'operator', ?, ?)",
    newId("rev"),
    workspaceId(),
    id,
    decision,
    note ?? null,
    now(),
  );
  audit("review", "claim", id, { decision });
}

/** 事实冲突检测：同一 claim_key 存在多条不同陈述（且都未废弃） */
export function listClaimConflicts(): Array<{ claim_key: string; n: number; statements: string }> {
  return all(
    `SELECT claim_key, COUNT(DISTINCT statement) AS n, GROUP_CONCAT(DISTINCT statement) AS statements
     FROM claims WHERE workspace_id = ? AND status != 'rejected'
     GROUP BY claim_key HAVING n > 1`,
    workspaceId(),
  );
}

export interface EvidenceRow {
  id: string;
  claim_id: string;
  kind: string;
  title: string;
  url: string | null;
  publisher: string | null;
  evidence_level: string;
  created_at: string;
}

export function listEvidences(claimId: string): EvidenceRow[] {
  return all<EvidenceRow>("SELECT * FROM evidences WHERE claim_id = ? ORDER BY created_at", claimId);
}

export function addEvidence(input: {
  claimId: string;
  kind?: string;
  title: string;
  url?: string;
  publisher?: string;
  evidenceLevel?: string;
}): void {
  run(
    `INSERT INTO evidences (id, workspace_id, claim_id, kind, title, url, publisher, published_at, evidence_level, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
    newId("ev"),
    workspaceId(),
    input.claimId,
    input.kind ?? "url",
    input.title,
    input.url ?? null,
    input.publisher ?? null,
    input.evidenceLevel ?? "self",
    now(),
  );
}

export function listProhibitedPhrases(): Array<{ id: string; phrase: string; severity: string; reason: string | null }> {
  return all("SELECT id, phrase, severity, reason FROM prohibited_phrases WHERE workspace_id = ? ORDER BY created_at", workspaceId());
}

export function addProhibitedPhrase(phrase: string, severity = "warn", reason?: string): void {
  const v = phrase.trim();
  if (!v) return;
  run(
    "INSERT INTO prohibited_phrases (id, workspace_id, brand_id, phrase, severity, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId("pp"),
    workspaceId(),
    getDefaultBrandId(),
    v,
    severity,
    reason ?? null,
    now(),
  );
}

/** 供评估引擎使用的已批准事实 */
export function getApprovedClaims(): Array<{ claimKey: string; statement: string; expectedNumber?: { value: number; unit?: string } }> {
  const rows = all<{ claim_key: string; statement: string }>(
    "SELECT claim_key, statement FROM claims WHERE workspace_id = ? AND status = 'approved'",
    workspaceId(),
  );
  return rows.map((r) => {
    const m = r.statement.match(/(\d+(?:[.,]\d+)?)\s*([%％]|件|台|套|吨|公斤|天|个工作日|工作日|小时|年|个月|元|美元)?/);
    if (!m) return { claimKey: r.claim_key, statement: r.statement };
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) return { claimKey: r.claim_key, statement: r.statement };
    return { claimKey: r.claim_key, statement: r.statement, expectedNumber: { value, unit: (m[2] ?? "").trim() } };
  });
}

/* =====================================================================
 * 模块 4：多平台采样
 * ===================================================================== */

export interface EngineRow {
  id: string;
  name: string;
  vendor: string | null;
  region: string;
  has_public_api: number;
  note: string | null;
}

const DEFAULT_ENGINES: Array<{ name: string; vendor: string; region: string; api: number; note: string }> = [
  { name: "ChatGPT", vendor: "OpenAI", region: "global", api: 1, note: "有官方 API，但 API 回答与消费端界面存在差异，必须分开统计。" },
  { name: "Perplexity", vendor: "Perplexity", region: "global", api: 1, note: "有官方 API。" },
  { name: "Gemini", vendor: "Google", region: "global", api: 1, note: "有官方 API。" },
  { name: "Google AI Overviews", vendor: "Google", region: "global", api: 0, note: "无公开 API，只能人工采样。" },
  { name: "Claude", vendor: "Anthropic", region: "global", api: 1, note: "有官方 API。" },
  { name: "Microsoft Copilot", vendor: "Microsoft", region: "global", api: 0, note: "无公开 API，只能人工采样。" },
  { name: "豆包", vendor: "字节跳动", region: "cn", api: 0, note: "无公开检索 API，只能人工采样。" },
  { name: "通义千问", vendor: "阿里", region: "cn", api: 0, note: "无公开检索 API，只能人工采样。" },
  { name: "腾讯元宝", vendor: "腾讯", region: "cn", api: 0, note: "无公开检索 API，只能人工采样。" },
  { name: "Kimi", vendor: "月之暗面", region: "cn", api: 0, note: "无公开检索 API，只能人工采样。" },
  { name: "DeepSeek", vendor: "深度求索", region: "cn", api: 0, note: "无公开检索 API，只能人工采样。" },
  { name: "文心一言", vendor: "百度", region: "cn", api: 0, note: "无公开检索 API，只能人工采样。" },
];

/** 首次调用时播种引擎清单；已存在则不动 */
export function listEngines(): EngineRow[] {
  const rows = all<EngineRow>("SELECT * FROM engines WHERE workspace_id = ? ORDER BY region, name", workspaceId());
  if (rows.length > 0) return rows;
  const stmt = getDb().prepare(
    "INSERT INTO engines (id, workspace_id, name, vendor, region, has_public_api, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const e of DEFAULT_ENGINES) {
    stmt.run(newId("eng"), workspaceId(), e.name, e.vendor, e.region, e.api, e.note, now());
  }
  return all<EngineRow>("SELECT * FROM engines WHERE workspace_id = ? ORDER BY region, name", workspaceId());
}

export interface SamplingRunRow {
  id: string;
  label: string;
  query_set_id: string | null;
  sampling_mode: string;
  status: string;
  task_count: number;
  sample_count: number;
  created_at: string;
}

export const SAMPLING_MODES = [
  { value: "manual_ui", label: "人工在消费者界面提问" },
  { value: "official_api", label: "官方 API" },
  { value: "approved_browser", label: "平台允许的授权浏览器流程" },
  { value: "import", label: "导入第三方数据" },
] as const;

export function listSamplingRuns(): SamplingRunRow[] {
  return all<SamplingRunRow>(
    `SELECT r.*,
       (SELECT COUNT(*) FROM sampling_tasks t WHERE t.run_id = r.id) AS task_count,
       (SELECT COUNT(*) FROM response_samples s WHERE s.run_id = r.id) AS sample_count
     FROM sampling_runs r WHERE r.workspace_id = ? ORDER BY r.created_at DESC`,
    workspaceId(),
  );
}

export function createSamplingRun(input: {
  label: string;
  querySetId: string;
  samplingMode: string;
  engines: string[];
  region?: string;
  repetition?: number;
  /** 本地门店维度（可选；品牌级采样不传） */
  storeId?: string | null;
  locationMode?: string;
  anchorId?: string | null;
  daypart?: string | null;
}): {
  runId: string;
  tasks: number;
} {
  const db = getDb();
  const qs = one<{ status: string }>("SELECT status FROM query_sets WHERE id = ? AND workspace_id = ?", input.querySetId, workspaceId());
  if (qs?.status !== "frozen") throw new Error("请先冻结当前工作区的问题集");
  if (!SAMPLING_MODES.some((m) => m.value === input.samplingMode)) throw new Error("不支持的采样方式");
  const engines = [...new Set(input.engines.map((e) => e.trim()).filter(Boolean))];
  if (!engines.length || engines.length > 20) throw new Error("请选择 1–20 个采样平台");
  if (!Number.isInteger(input.repetition ?? 1) || (input.repetition ?? 1) < 1 || (input.repetition ?? 1) > 10) throw new Error("重复次数必须是 1–10 的整数");
  const runId = newId("run_s");
  run(
    `INSERT INTO sampling_runs
      (id, workspace_id, query_set_id, label, sampling_mode, status, store_id, location_mode, anchor_id, daypart, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    runId,
    workspaceId(),
    input.querySetId,
    input.label,
    input.samplingMode,
    input.storeId ?? null,
    // 未显式指定一律记为 unspecified —— 不能默认成 device_location，
    // 那会把"没标注"当成"用了真实定位"，是最危险的一种默认值
    input.locationMode ?? "unspecified",
    input.anchorId ?? null,
    input.daypart ?? null,
    now(),
  );

  const questions = all<{ id: string; text: string }>(
    "SELECT id, text FROM questions WHERE query_set_id = ? ORDER BY created_at",
    input.querySetId,
  );
  const rep = Math.max(1, Math.min(10, input.repetition ?? 1));
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO sampling_tasks
      (id, workspace_id, run_id, question_id, question_text, engine, region, repetition, status, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  );
  let tasks = 0;
  for (const q of questions) {
    for (const engine of engines) {
      for (let r = 1; r <= rep; r++) {
        // 相同问题必须能在下一批次复测；幂等范围只能是当前批次。
        const key = [workspaceId(), runId, q.id, engine, input.samplingMode, input.region ?? "-", r].join("|");
        const inserted = stmt.run(newId("task"), workspaceId(), runId, q.id, q.text, engine, input.region ?? null, r, key, now());
        tasks += Number(inserted.changes);
      }
    }
  }
  audit("create", "sampling_run", runId, { tasks, engines: input.engines.length });
  return { runId, tasks };
}

export interface SamplingTaskRow {
  id: string;
  run_id: string;
  question_id: string;
  question_text: string;
  engine: string;
  region: string | null;
  repetition: number;
  status: string;
}

export function listSamplingTasks(runId: string): SamplingTaskRow[] {
  return all<SamplingTaskRow>("SELECT * FROM sampling_tasks WHERE run_id = ? ORDER BY engine, created_at", runId);
}

/** 写入一条采样结果，并把任务标记为已采集 */
export function saveSample(input: {
  taskId: string;
  rawAnswer: string;
  modelVersion?: string;
  region?: string;
  collectedAt?: string;
  /** 可复核的原始凭证：平台分享链接与截图路径 */
  shareUrl?: string;
  screenshotPath?: string;
}): { sampleId: string } {
  const task = one<{ id: string; run_id: string; question_id: string; engine: string; region: string | null; repetition: number }>(
    "SELECT id, run_id, question_id, engine, region, repetition FROM sampling_tasks WHERE id = ? AND workspace_id = ?",
    input.taskId,
    workspaceId(),
  );
  if (!task) throw new Error("采样任务不存在");
  if (!input.rawAnswer.trim()) throw new Error("回答不能为空");
  const existing = one<{ id: string }>(
    "SELECT id FROM response_samples WHERE run_id = ? AND question_id = ? AND engine = ? AND region IS ? AND repetition = ? LIMIT 1",
    task.run_id, task.question_id, task.engine, input.region ?? task.region, task.repetition,
  );
  if (existing) return { sampleId: existing.id };

  const runRow = one<{ sampling_mode: string; location_mode: string | null; anchor_id: string | null }>(
    "SELECT sampling_mode, location_mode, anchor_id FROM sampling_runs WHERE id = ?",
    task.run_id,
  );
  const sampleId = newId("smp");
  const t = now();
  run(
    `INSERT INTO response_samples
      (id, workspace_id, run_id, question_id, engine, sampling_mode, region, repetition, raw_answer,
       content_hash, collected_at, created_at, location_mode, anchor_id, share_url, screenshot_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    sampleId,
    workspaceId(),
    task.run_id,
    task.question_id,
    task.engine,
    runRow?.sampling_mode ?? "manual_ui",
    input.region ?? task.region,
    task.repetition,
    input.rawAnswer,
    input.collectedAt ?? t,
    t,
    // 样本级定位方式随批次写入后不可变
    runRow?.location_mode ?? "unspecified",
    runRow?.anchor_id ?? null,
    input.shareUrl ?? null,
    input.screenshotPath ?? null,
  );
  if (input.modelVersion) {
    run("UPDATE response_samples SET content_hash = ? WHERE id = ?", `mv:${input.modelVersion}`, sampleId);
  }
  run("UPDATE sampling_tasks SET status = 'collected' WHERE id = ?", task.id);
  audit("create", "response_sample", sampleId, { engine: task.engine });
  return { sampleId };
}

export interface SampleRow {
  id: string;
  run_id: string;
  question_id: string | null;
  question_text: string | null;
  engine: string;
  sampling_mode: string;
  region: string | null;
  raw_answer: string;
  collected_at: string;
  evaluated: number;
}

export function listSamples(runId?: string): SampleRow[] {
  const sql = `SELECT s.*, q.text AS question_text,
      (SELECT COUNT(*) FROM evaluation_results e WHERE e.sample_id = s.id) AS evaluated
    FROM response_samples s LEFT JOIN questions q ON q.id = s.question_id
    WHERE s.workspace_id = ? ${runId ? "AND s.run_id = ?" : ""}
    ORDER BY s.collected_at DESC LIMIT 500`;
  return runId
    ? all<SampleRow>(sql, workspaceId(), runId)
    : all<SampleRow>(sql, workspaceId());
}

export function getSample(id: string): SampleRow | undefined {
  return one<SampleRow>(
    `SELECT s.*, q.text AS question_text,
      (SELECT COUNT(*) FROM evaluation_results e WHERE e.sample_id = s.id) AS evaluated
     FROM response_samples s LEFT JOIN questions q ON q.id = s.question_id
     WHERE s.id = ? AND s.workspace_id = ?`,
    id,
    workspaceId(),
  );
}

/**
 * CSV 导入。约定列（大小写不敏感）：
 *   question | engine | answer [| region | model_version | collected_at]
 * 首行为表头。answer 内可含换行（用引号包裹）时按简易 CSV 解析。
 */
export function importSamplesCsv(runId: string, csv: string): { imported: number; errors: string[] } {
  const targetRun = one<{ sampling_mode: string }>("SELECT sampling_mode FROM sampling_runs WHERE id = ? AND workspace_id = ?", runId, workspaceId());
  if (!targetRun) return { imported: 0, errors: ["采样批次不存在"] };
  if (targetRun.sampling_mode === "official_api") return { imported: 0, errors: ["官方 API 批次必须由连接器采集，请为 CSV 数据另建导入批次"] };
  const rows = parseCsv(csv);
  const errors: string[] = [];
  let imported = 0;
  if (rows.length < 2) return { imported: 0, errors: ["CSV 至少需要表头与一行数据"] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const qi = idx("question");
  const ei = idx("engine");
  const ai = idx("answer");
  const ri = idx("region");
  const mi = idx("model_version");
  const ci = idx("collected_at");
  if (qi === -1 || ei === -1 || ai === -1) {
    return { imported: 0, errors: ["缺少必需列：question / engine / answer"] };
  }

  const tasks = listSamplingTasks(runId);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const question = (r[qi] ?? "").trim();
    const engine = (r[ei] ?? "").trim();
    const answer = (r[ai] ?? "").trim();
    if (!question || !engine || !answer) {
      errors.push(`第 ${i + 1} 行：question / engine / answer 有空值`);
      continue;
    }
    // 优先匹配已有任务；匹配不到则按「问题文本 + 引擎」建任务，保证导入不丢数据
    let task = tasks.find((t) => t.question_text.trim() === question && t.engine === engine && t.status === "pending");
    if (!task && tasks.some((t) => t.question_text.trim() === question && t.engine === engine)) {
      errors.push(`第 ${i + 1} 行：对应任务已采集，不重复写入`);
      continue;
    }
    if (!task) {
      const q = one<{ id: string }>(
        "SELECT q.id FROM questions q JOIN sampling_runs r ON r.query_set_id = q.query_set_id WHERE r.id = ? AND q.text = ? LIMIT 1",
        runId,
        question,
      );
      if (!q) {
        errors.push(`第 ${i + 1} 行：问题「${question.slice(0, 30)}」不属于该采样批次的问题集`);
        continue;
      }
      const taskId = newId("task");
      const key = [workspaceId(), runId, q.id, engine, "import", "-", 1].join("|");
      run(
        `INSERT OR IGNORE INTO sampling_tasks (id, workspace_id, run_id, question_id, question_text, engine, region, repetition, status, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)`,
        taskId,
        workspaceId(),
        runId,
        q.id,
        question,
        engine,
        ri >= 0 ? (r[ri] ?? "").trim() || null : null,
        key,
        now(),
      );
      task = { id: taskId, run_id: runId, question_id: q.id, question_text: question, engine, region: ri >= 0 ? (r[ri] ?? "").trim() || null : null, repetition: 1, status: "pending" };
      tasks.push(task);
    }
    saveSample({
      taskId: task.id,
      rawAnswer: answer,
      region: ri >= 0 ? (r[ri] ?? "").trim() || undefined : undefined,
      modelVersion: mi >= 0 ? (r[mi] ?? "").trim() || undefined : undefined,
      collectedAt: ci >= 0 ? (r[ci] ?? "").trim() || undefined : undefined,
    });
    task.status = "collected";
    imported++;
  }
  audit("import", "response_samples", runId, { imported });
  return { imported, errors };
}

/** 极简 CSV 解析：支持双引号包裹与转义的双引号 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/* =====================================================================
 * 模块 5：评估与指标
 * ===================================================================== */

export function saveEvaluation(input: {
  sampleId: string;
  evaluator: string;
  version: string;
  result: unknown;
  confidence: number;
  needsReview?: boolean;
}): void {
  // 同一评估器重算时覆盖旧结果，避免指标重复累加
  run(
    "DELETE FROM evaluation_results WHERE sample_id = ? AND evaluator = ?",
    input.sampleId,
    input.evaluator,
  );
  run(
    `INSERT INTO evaluation_results (id, workspace_id, sample_id, evaluator, evaluator_version, result_json, confidence, needs_review, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("eval"),
    workspaceId(),
    input.sampleId,
    input.evaluator,
    input.version,
    JSON.stringify(input.result),
    input.confidence,
    input.needsReview ? 1 : 0,
    now(),
  );
}

export interface EvaluationRow {
  sample_id: string;
  evaluator: string;
  evaluator_version: string;
  result_json: string;
  confidence: number;
  needs_review: number;
}

export function listEvaluations(sampleIds: string[]): EvaluationRow[] {
  if (sampleIds.length === 0) return [];
  const placeholders = sampleIds.map(() => "?").join(",");
  return all<EvaluationRow>(
    `SELECT sample_id, evaluator, evaluator_version, result_json, confidence, needs_review
     FROM evaluation_results WHERE sample_id IN (${placeholders})`,
    ...sampleIds,
  );
}

/**
 * 写入指标快照。
 *
 * `runId` 为 null 表示「跨批次的全部样本」范围 —— 此时 run_id 存 NULL。
 * ⚠️ 千万不要为了"有个值"而编造 run id：run_id 是指向 sampling_runs 的外键，
 * 写一个不存在的 id 会直接触发 FOREIGN KEY constraint failed（已发生过的缺陷）。
 */
export function saveMetricSnapshot(input: {
  runId: string | null;
  metric: string;
  value: number;
  numerator: number;
  denominator: number;
  dimension: Record<string, unknown>;
}): void {
  if (input.runId !== null && !one<{ id: string }>("SELECT id FROM sampling_runs WHERE id = ?", input.runId)) {
    throw new Error(`指标快照的 run_id 不存在：${input.runId}。跨批次范围请传 null。`);
  }
  run(
    `INSERT INTO metric_snapshots (id, workspace_id, run_id, metric, value, numerator, denominator, dimension_json, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("snap"),
    workspaceId(),
    input.runId,
    input.metric,
    input.value,
    input.numerator,
    input.denominator,
    JSON.stringify(input.dimension),
    now(),
  );
}

export interface MetricSnapshotRow {
  id: string;
  run_id: string | null;
  metric: string;
  value: number;
  numerator: number;
  denominator: number;
  dimension_json: string;
  computed_at: string;
  run_label: string | null;
}

/**
 * 读取指标快照。
 *  - 不传 runId：返回全部（含跨批次范围的 run_id=NULL 记录），按计算时间倒序
 *  - 传 runId：只看该批次
 */
export function listMetricSnapshots(runId?: string): MetricSnapshotRow[] {
  const sql = `SELECT m.*, r.label AS run_label FROM metric_snapshots m
    LEFT JOIN sampling_runs r ON r.id = m.run_id
    WHERE m.workspace_id = ? ${runId ? "AND m.run_id = ?" : ""}
    ORDER BY m.computed_at DESC LIMIT 200`;
  return runId ? all<MetricSnapshotRow>(sql, workspaceId(), runId) : all<MetricSnapshotRow>(sql, workspaceId());
}

export function countPendingReviews(): number {
  return (
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM evaluation_results WHERE workspace_id = ? AND needs_review = 1",
      workspaceId(),
    )?.n ?? 0
  );
}

/* =====================================================================
 * 模块 6：内容与推广
 * ===================================================================== */

export interface BriefRow {
  id: string;
  title: string;
  gap_reason: string | null;
  outline: string | null;
  status: string;
  asset_count: number;
  created_at: string;
}

export function listBriefs(): BriefRow[] {
  return all<BriefRow>(
    `SELECT b.*, (SELECT COUNT(*) FROM content_assets a WHERE a.brief_id = b.id) AS asset_count
     FROM content_briefs b WHERE b.workspace_id = ? ORDER BY b.created_at DESC`,
    workspaceId(),
  );
}

export function createBrief(input: { title: string; gapReason?: string; outline?: string }): string {
  const id = newId("brief");
  run(
    `INSERT INTO content_briefs (id, workspace_id, brand_id, title, gap_reason, outline, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    id,
    workspaceId(),
    getDefaultBrandId(),
    input.title,
    input.gapReason ?? null,
    input.outline ?? null,
    now(),
    now(),
  );
  audit("create", "content_brief", id, { title: input.title });
  return id;
}

export interface AssetRow {
  id: string;
  brief_id: string | null;
  kind: string;
  title: string;
  slug: string | null;
  status: string;
  author: string | null;
  reviewer: string | null;
  published_at: string | null;
  body_md: string | null;
  created_at: string;
  pub_count: number;
  template_id?: string | null;
  claim_count?: number;
  evidence_count?: number;
}

export function listAssets(): AssetRow[] {
  return all<AssetRow>(
    `SELECT a.*,
       (SELECT COUNT(*) FROM publications p WHERE p.asset_id = a.id) AS pub_count,
       (SELECT COUNT(*) FROM content_claim_links l WHERE l.asset_id = a.id) AS claim_count,
       (SELECT COUNT(DISTINCT e.id) FROM content_claim_links l
          JOIN evidences e ON e.claim_id = l.claim_id WHERE l.asset_id = a.id) AS evidence_count
     FROM content_assets a WHERE a.workspace_id = ? ORDER BY a.created_at DESC`,
    workspaceId(),
  );
}

export function createAsset(input: {
  briefId?: string;
  kind?: string;
  title: string;
  bodyMd?: string;
  author?: string;
  templateId?: string | null;
  questionIds?: string[];
  claimIds?: string[];
}): string {
  const id = newId("asset");
  const t = now();
  const slug = input.title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  run(
    `INSERT INTO content_assets (id, workspace_id, brief_id, kind, title, slug, body_md, status, author, reviewer, published_at, created_at, updated_at, template_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, NULL, ?, ?, ?)`,
    id,
    workspaceId(),
    input.briefId ?? null,
    input.kind ?? "article",
    input.title,
    slug,
    input.bodyMd ?? null,
    input.author ?? null,
    t,
    t,
    input.templateId ?? null,
  );
  for (const qid of input.questionIds ?? []) {
    run("INSERT INTO content_question_links (id, asset_id, question_id, created_at) VALUES (?, ?, ?, ?)", newId("cql"), id, qid, t);
  }
  for (const cid of input.claimIds ?? []) {
    run("INSERT INTO content_claim_links (id, asset_id, claim_id, created_at) VALUES (?, ?, ?, ?)", newId("ccl"), id, cid, t);
  }
  audit("create", "content_asset", id, { title: input.title });
  return id;
}

export function reviewAsset(id: string, decision: "approved" | "rejected", note?: string, reviewer = "operator"): void {
  run(
    "UPDATE content_assets SET status = ?, reviewer = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    decision === "approved" ? "approved" : "draft",
    reviewer,
    now(),
    id,
    workspaceId(),
  );
  run(
    "INSERT INTO review_decisions (id, workspace_id, entity, entity_id, decision, actor, note, decided_at) VALUES (?, ?, 'content_asset', ?, ?, ?, ?, ?)",
    newId("rev"),
    workspaceId(),
    id,
    decision,
    reviewer,
    note ?? null,
    now(),
  );
}

export function publishAsset(id: string, url: string, channelId?: string, publishedAt?: string, fee?: number): void {
  const t = now();
  run(
    "UPDATE content_assets SET status = 'published', published_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    publishedAt ?? t,
    t,
    id,
    workspaceId(),
  );
  const pubId = newId("pub");
  run(
    `INSERT INTO publications (id, workspace_id, task_id, asset_id, url, published_at, fee, note, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?)`,
    pubId,
    workspaceId(),
    id,
    url,
    publishedAt ?? t,
    fee ?? null,
    t,
  );
  if (channelId) {
    run(
      `INSERT INTO publication_tasks (id, workspace_id, asset_id, channel_id, status, owner, due_at, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', 'operator', NULL, NULL, ?, ?)`,
      newId("pt"),
      workspaceId(),
      id,
      channelId,
      t,
      t,
    );
  }
  audit("publish", "content_asset", id, { url });
}

export interface ChannelRow {
  id: string;
  kind: string;
  name: string;
  note: string | null;
}

export function listChannels(): ChannelRow[] {
  return all<ChannelRow>("SELECT * FROM distribution_channels WHERE workspace_id = ? ORDER BY kind, name", workspaceId());
}

export function createChannel(kind: string, name: string, note?: string): void {
  run(
    "INSERT INTO distribution_channels (id, workspace_id, kind, name, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId("ch"),
    workspaceId(),
    kind,
    name,
    note ?? null,
    now(),
  );
}

export interface PublicationRow {
  id: string;
  asset_id: string;
  asset_title: string | null;
  url: string | null;
  published_at: string | null;
  fee: number | null;
}

export function listPublications(): PublicationRow[] {
  return all<PublicationRow>(
    `SELECT p.*, a.title AS asset_title FROM publications p
     LEFT JOIN content_assets a ON a.id = p.asset_id
     WHERE p.workspace_id = ? ORDER BY p.created_at DESC LIMIT 200`,
    workspaceId(),
  );
}

/* =====================================================================
 * 模块 7：获客归因
 * ===================================================================== */

export function updateLeadStatus(leadId: string, toStatus: string, note?: string, actor = "operator"): void {
  const cur = one<{ status: string }>("SELECT status FROM leads WHERE id = ? AND workspace_id = ?", leadId, workspaceId());
  if (!cur) return;
  const t = now();
  run("UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?", toStatus, t, leadId, workspaceId());
  run(
    "INSERT INTO lead_status_history (id, workspace_id, lead_id, from_status, to_status, actor, note, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    newId("lsh"),
    workspaceId(),
    leadId,
    cur.status,
    toStatus,
    actor,
    note ?? null,
    t,
  );
  audit("status_change", "lead", leadId, { from: cur.status, to: toStatus });
}

export function addTouchpoint(input: {
  leadId: string;
  kind: "first_touch" | "last_non_direct" | "self_reported" | "assist";
  path?: string;
  referrer?: string;
  toolRunId?: string;
  note?: string;
}): void {
  run(
    `INSERT INTO lead_touchpoints (id, workspace_id, lead_id, kind, path, referrer, tool_run_id, note, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("tp"),
    workspaceId(),
    input.leadId,
    input.kind,
    input.path ?? null,
    input.referrer ?? null,
    input.toolRunId ?? null,
    input.note ?? null,
    now(),
  );
}

export interface LeadHistoryRow {
  to_status: string;
  from_status: string | null;
  actor: string;
  note: string | null;
  changed_at: string;
}

export function listLeadHistory(leadId: string): LeadHistoryRow[] {
  return all<LeadHistoryRow>(
    "SELECT to_status, from_status, actor, note, changed_at FROM lead_status_history WHERE lead_id = ? ORDER BY changed_at DESC",
    leadId,
  );
}

/** 三种归因模型的结果，各自独立展示（不做多触点加权，避免假精确） */
export interface AttributionSummary {
  firstTouch: Array<{ label: string; n: number }>;
  lastNonDirect: Array<{ label: string; n: number }>;
  selfReported: Array<{ label: string; n: number }>;
  byStatus: Array<{ status: string; n: number }>;
}

export function getAttributionSummary(): AttributionSummary {
  const ws = workspaceId();
  return {
    firstTouch: all(
      `SELECT COALESCE(json_extract(first_touch_json,'$.landingPath'),'(未记录)') AS label, COUNT(*) AS n
       FROM leads WHERE workspace_id = ? GROUP BY label ORDER BY n DESC LIMIT 8`,
      ws,
    ),
    lastNonDirect: all(
      `SELECT COALESCE(NULLIF(referrer,''),'(直接访问)') AS label, COUNT(*) AS n
       FROM events WHERE workspace_id = ? AND name IN ('tool_run','lead_submit') GROUP BY label ORDER BY n DESC LIMIT 8`,
      ws,
    ),
    selfReported: all(
      `SELECT COALESCE(NULLIF(self_reported_source,''),'(未填写)') AS label, COUNT(*) AS n
       FROM leads WHERE workspace_id = ? GROUP BY label ORDER BY n DESC LIMIT 8`,
      ws,
    ),
    byStatus: all("SELECT status, COUNT(*) AS n FROM leads WHERE workspace_id = ? GROUP BY status ORDER BY n DESC", ws),
  };
}
