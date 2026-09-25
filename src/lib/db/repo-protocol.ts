/**
 * 采样协议仓储层。
 *
 * 一条硬规则：**指标按 protocol_id 分组，跨协议不混算。**
 * 因此每个采样批次在创建时就绑定协议；没有协议的批次会被明确标记为
 * "未绑定协议"，其数据不参与任何前后对比。
 */
import { getDb, workspaceId, audit } from "./index.ts";
import { newId } from "../id.ts";
import {
  cloneProtocolConditions,
  compareProtocols,
  describeProtocol,
  protocolFingerprint,
  type ProtocolComparison,
  type ProtocolConditions,
  type SamplingSurface,
} from "../protocol.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const all = <T>(sql: string, ...a: any[]): T[] => getDb().prepare(sql).all(...a) as unknown as T[];
const one = <T>(sql: string, ...a: any[]): T | undefined => getDb().prepare(sql).get(...a) as unknown as T;
const run = (sql: string, ...a: any[]) => getDb().prepare(sql).run(...a);
const now = () => new Date().toISOString();

export interface ProtocolRow {
  id: string;
  query_set_id: string;
  query_set_version: number;
  label: string;
  engines_json: string;
  repetition: number;
  region: string | null;
  web_search: number;
  surface: string;
  location_mode: string;
  anchor_id: string | null;
  daypart: string | null;
  model_version: string | null;
  fingerprint: string;
  cloned_from: string | null;
  locked_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  run_count?: number;
}

export function rowToConditions(row: ProtocolRow): ProtocolConditions {
  let engines: string[] = [];
  try {
    const parsed = JSON.parse(row.engines_json) as unknown;
    if (Array.isArray(parsed)) engines = parsed.filter((e): e is string => typeof e === "string");
  } catch {
    engines = [];
  }
  return {
    querySetId: row.query_set_id,
    querySetVersion: row.query_set_version,
    engines,
    repetition: row.repetition,
    region: row.region,
    webSearch: row.web_search === 1,
    surface: (row.surface === "official_api" ? "official_api" : "manual_ui") as SamplingSurface,
    locationMode: row.location_mode,
    anchorId: row.anchor_id,
    daypart: row.daypart,
    modelVersion: row.model_version,
  };
}

export function listProtocols(): ProtocolRow[] {
  return all<ProtocolRow>(
    `SELECT p.*, (SELECT COUNT(*) FROM sampling_runs r WHERE r.protocol_id = p.id) AS run_count
       FROM sampling_protocols p WHERE p.workspace_id = ?
      ORDER BY p.created_at DESC`,
    workspaceId(),
  );
}

export function getProtocol(id: string): ProtocolRow | undefined {
  return one<ProtocolRow>("SELECT * FROM sampling_protocols WHERE id = ? AND workspace_id = ?", id, workspaceId());
}

/** 按指纹查找已有协议 —— 相同条件不应该产生两份协议 */
export function findProtocolByFingerprint(fingerprint: string): ProtocolRow | undefined {
  return one<ProtocolRow>(
    "SELECT * FROM sampling_protocols WHERE workspace_id = ? AND fingerprint = ?",
    workspaceId(),
    fingerprint,
  );
}

export interface CreateProtocolInput extends Omit<ProtocolConditions, "querySetVersion"> {
  label: string;
  /** 冻结版本；未提供时从 query_sets 读取当前版本 */
  querySetVersion?: number;
  note?: string | null;
  clonedFrom?: string | null;
}

/**
 * 创建协议。
 *
 * 指纹相同的协议不会重复创建 —— 直接返回已有的那份，
 * 避免"同条件却被当成两份协议"从而把数据拆散。
 */
export function createProtocol(input: CreateProtocolInput): { id: string; created: boolean } {
  const qs = one<{ version: number; status: string }>(
    "SELECT version, status FROM query_sets WHERE id = ? AND workspace_id = ?",
    input.querySetId,
    workspaceId(),
  );
  if (!qs) throw new Error("问题集不存在");
  if (qs.status !== "frozen") throw new Error("只能基于已冻结的问题集建立协议 —— 未冻结的问题还会变，条件就不固定");

  const version = input.querySetVersion ?? qs.version;
  const conditions: ProtocolConditions = { ...input, querySetVersion: version };
  const fingerprint = protocolFingerprint(conditions);

  const existing = findProtocolByFingerprint(fingerprint);
  if (existing) return { id: existing.id, created: false };

  const id = newId("proto");
  const t = now();
  run(
    `INSERT INTO sampling_protocols
       (id, workspace_id, query_set_id, query_set_version, label, engines_json, repetition, region,
        web_search, surface, location_mode, anchor_id, daypart, model_version, fingerprint,
        cloned_from, locked_at, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    workspaceId(),
    input.querySetId,
    version,
    input.label,
    JSON.stringify(conditions.engines ?? []),
    conditions.repetition ?? 1,
    conditions.region ?? null,
    conditions.webSearch ? 1 : 0,
    conditions.surface ?? "manual_ui",
    conditions.locationMode ?? "unspecified",
    conditions.anchorId ?? null,
    conditions.daypart ?? null,
    conditions.modelVersion ?? null,
    fingerprint,
    input.clonedFrom ?? null,
    // 创建即锁定：条件不再变，变条件就新建一份协议
    t,
    input.note ?? null,
    t,
    t,
  );
  audit("create", "sampling_protocol", id, { label: input.label, fingerprint, clonedFrom: input.clonedFrom ?? null });
  return { id, created: true };
}

/**
 * 从已有协议复制一份复测协议。
 *
 * 复测允许覆盖的条件只有"环境类"的：地区、模型版本、时段、锚点。
 * 平台、联网开关、界面、问题集版本这些一旦改动就不叫复测了 ——
 * 因此**不提供**覆盖它们的参数，而不是靠调用方自觉。
 */
export function cloneProtocol(
  sourceId: string,
  overrides: { label?: string; region?: string | null; modelVersion?: string | null; daypart?: string | null; anchorId?: string | null } = {},
): { id: string; created: boolean; comparison: ProtocolComparison } {
  const source = getProtocol(sourceId);
  if (!source) throw new Error("协议不存在");
  const base = rowToConditions(source);
  const next = cloneProtocolConditions(base, {
    region: overrides.region !== undefined ? overrides.region : base.region,
    modelVersion: overrides.modelVersion !== undefined ? overrides.modelVersion : base.modelVersion,
    daypart: overrides.daypart !== undefined ? overrides.daypart : base.daypart,
    anchorId: overrides.anchorId !== undefined ? overrides.anchorId : base.anchorId,
  });
  const result = createProtocol({
    ...next,
    label: overrides.label ?? `${source.label} · 复测`,
    clonedFrom: sourceId,
  });
  // 复制出来的协议与来源的差异必须当场算出来并存进审计 ——
  // 事后没人记得当时改了什么
  const comparison = compareProtocols(base, next);
  audit("clone", "sampling_protocol", result.id, {
    from: sourceId,
    differences: comparison.differences,
    comparable: comparison.comparable,
  });
  return { id: result.id, created: result.created, comparison };
}

/** 两份协议能否直接对比 */
export function compareProtocolIds(baselineId: string, retestId: string): ProtocolComparison {
  const a = getProtocol(baselineId);
  const b = getProtocol(retestId);
  if (!a || !b) throw new Error("协议不存在");
  return compareProtocols(rowToConditions(a), rowToConditions(b));
}

/** 协议归属的采样批次 */
export function listRunsForProtocol(protocolId: string): Array<{ id: string; label: string; created_at: string; sample_count: number }> {
  return all<{ id: string; label: string; created_at: string; sample_count: number }>(
    `SELECT r.id, r.label, r.created_at,
            (SELECT COUNT(*) FROM response_samples s WHERE s.run_id = r.id) AS sample_count
       FROM sampling_runs r
      WHERE r.workspace_id = ? AND r.protocol_id = ?
      ORDER BY r.created_at ASC`,
    workspaceId(),
    protocolId,
  );
}

/** 没有绑定协议的批次 —— 这些数据不参与任何前后对比，必须能被看见 */
export function listUnboundRuns(): Array<{ id: string; label: string; created_at: string; sample_count: number }> {
  return all<{ id: string; label: string; created_at: string; sample_count: number }>(
    `SELECT r.id, r.label, r.created_at,
            (SELECT COUNT(*) FROM response_samples s WHERE s.run_id = r.id) AS sample_count
       FROM sampling_runs r
      WHERE r.workspace_id = ? AND (r.protocol_id IS NULL OR r.protocol_id = '')
      ORDER BY r.created_at DESC`,
    workspaceId(),
  );
}

export function describeProtocolRow(row: ProtocolRow): string {
  return describeProtocol(rowToConditions(row));
}

/** 问题分类统计（用于问题库页面提示分类覆盖情况） */
export function questionCategories(querySetId?: string): Array<string | null> {
  const sql = `SELECT category FROM questions WHERE workspace_id = ? ${querySetId ? "AND query_set_id = ?" : ""}`;
  const rows = querySetId
    ? all<{ category: string | null }>(sql, workspaceId(), querySetId)
    : all<{ category: string | null }>(sql, workspaceId());
  return rows.map((r) => r.category);
}

export function setQuestionCategory(questionId: string, category: string | null): void {
  run("UPDATE questions SET category = ? WHERE id = ? AND workspace_id = ?", category, questionId, workspaceId());
  audit("set_category", "question", questionId, { category });
}
