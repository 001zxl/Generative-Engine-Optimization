/**
 * 第三方信源台账仓储层。
 *
 * 可用性核对走 @/lib/net/fetch-page（SSRF 防护 + DNS 固定），
 * 不对第三方页面做任何写入 —— 只读、只记录结果。
 */
import { getDb, workspaceId, audit } from "./index.ts";
import { newId } from "../id.ts";
import { fetchPage } from "../net/fetch-page.ts";
import {
  checkExternalSource,
  summarizeClaimSources,
  type ClaimSourceSummary,
  type ExternalSourceInput,
} from "../external-sources.ts";
import { safePublicationUrl } from "../publishing.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const all = <T>(sql: string, ...a: any[]): T[] => getDb().prepare(sql).all(...a) as unknown as T[];
const one = <T>(sql: string, ...a: any[]): T | undefined => getDb().prepare(sql).get(...a) as unknown as T;
const run = (sql: string, ...a: any[]) => getDb().prepare(sql).run(...a);
const now = () => new Date().toISOString();

export interface ExternalSourceRow {
  id: string;
  brand_id: string | null;
  store_id: string | null;
  claim_id: string | null;
  platform: string;
  url: string;
  title: string | null;
  topic: string | null;
  source_kind: string;
  published_at: string | null;
  last_checked_at: string | null;
  last_status: string;
  last_http_status: number | null;
  last_note: string | null;
  conflict_note: string | null;
  conflict_with_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  claim_key?: string | null;
  brand_name?: string | null;
}

export function rowToInput(row: ExternalSourceRow): ExternalSourceInput {
  return {
    id: row.id,
    claimId: row.claim_id,
    platform: row.platform,
    url: row.url,
    title: row.title,
    topic: row.topic,
    kind: row.source_kind,
    publishedAt: row.published_at,
    lastCheckedAt: row.last_checked_at,
    lastStatus: row.last_status,
    lastHttpStatus: row.last_http_status,
    conflictNote: row.conflict_note,
    note: row.note,
  };
}

export function listExternalSources(filter: { brandId?: string; claimId?: string } = {}): ExternalSourceRow[] {
  const where = ["s.workspace_id = ?"];
  const args: unknown[] = [workspaceId()];
  if (filter.brandId) {
    where.push("s.brand_id = ?");
    args.push(filter.brandId);
  }
  if (filter.claimId) {
    where.push("s.claim_id = ?");
    args.push(filter.claimId);
  }
  return all<ExternalSourceRow>(
    `SELECT s.*, c.claim_key AS claim_key, b.name AS brand_name
       FROM external_sources s
       LEFT JOIN claims c ON c.id = s.claim_id
       LEFT JOIN brands b ON b.id = s.brand_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.source_kind, s.platform, s.created_at DESC`,
    ...args,
  );
}

export function getExternalSource(id: string): ExternalSourceRow | undefined {
  return one<ExternalSourceRow>("SELECT * FROM external_sources WHERE id = ? AND workspace_id = ?", id, workspaceId());
}

export interface CreateExternalSourceInput {
  brandId?: string | null;
  storeId?: string | null;
  claimId?: string | null;
  platform: string;
  url: string;
  title?: string | null;
  topic?: string | null;
  sourceKind: string;
  publishedAt?: string | null;
  note?: string | null;
}

/**
 * 登记一条外部来源。
 *
 * URL 走与发布模块同一套白名单（safePublicationUrl）：只接受 http(s)、
 * 不带账号密码。台账是给客户看的，里面不该出现任何奇怪协议。
 */
export function createExternalSource(input: CreateExternalSourceInput): string {
  const url = safePublicationUrl(input.url);
  if (!url) throw new Error("来源 URL 必须是 http(s) 且不含账号密码");
  if (!input.platform.trim()) throw new Error("请填写来源平台");
  const existing = one<{ id: string }>("SELECT id FROM external_sources WHERE workspace_id = ? AND url = ?", workspaceId(), url);
  if (existing) throw new Error("这条 URL 已登记过；同一页面不重复记录，避免把一篇当成两篇");
  const id = newId("ext");
  const t = now();
  run(
    `INSERT INTO external_sources
       (id, workspace_id, brand_id, store_id, claim_id, platform, url, title, topic, source_kind,
        published_at, last_status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?)`,
    id,
    workspaceId(),
    input.brandId ?? null,
    input.storeId ?? null,
    input.claimId ?? null,
    input.platform.trim(),
    url,
    input.title?.trim() || null,
    input.topic?.trim() || null,
    input.sourceKind,
    input.publishedAt?.trim() || null,
    input.note?.trim() || null,
    t,
    t,
  );
  audit("create", "external_source", id, { platform: input.platform, kind: input.sourceKind });
  return id;
}

export function setSourceConflict(id: string, conflictNote: string, conflictWithId?: string | null): void {
  run(
    "UPDATE external_sources SET conflict_note = ?, conflict_with_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    conflictNote.trim() || null,
    conflictWithId ?? null,
    now(),
    id,
    workspaceId(),
  );
  audit("set_conflict", "external_source", id, { conflictNote });
}

export function deleteExternalSource(id: string): void {
  run("DELETE FROM external_sources WHERE id = ? AND workspace_id = ?", id, workspaceId());
  audit("delete", "external_source", id, {});
}

/**
 * 核对一条来源是否仍可访问。
 *
 * 判定口径：
 *  - 2xx 且正文里能找到标题关键词 → ok
 *  - 2xx 但找不到 → mismatch（页面还在但内容变了，不能继续作为该事实的依据）
 *  - 404/410 → dead
 *  - 被 SSRF 防护拒绝 → blocked（本机/内网地址，无法核对）
 *  - 其它错误 → blocked
 */
export async function checkExternalSourceLiveness(id: string): Promise<{ status: string; note: string }> {
  const row = getExternalSource(id);
  if (!row) throw new Error("来源不存在");
  const result = await fetchPage(row.url);
  let status: string;
  let note: string;

  if (result.ok && result.status !== undefined) {
    const body = result.body ?? "";
    const probe = (row.title ?? "").trim().slice(0, 12);
    if (!probe || body.includes(probe)) {
      status = "ok";
      note = `HTTP ${result.status}，页面可访问${probe ? "且找到标题关键词" : "（未设标题，未做内容比对）"}`;
    } else {
      status = "mismatch";
      note = `HTTP ${result.status}，但页面上找不到标题关键词「${probe}」—— 内容可能已变更`;
    }
  } else if (result.status === 404 || result.status === 410) {
    status = "dead";
    note = `HTTP ${result.status} —— 页面已不存在`;
  } else {
    status = "blocked";
    note = result.error ?? `HTTP ${result.status ?? "无响应"} —— 无法自动核对`;
  }

  const t = now();
  run(
    "UPDATE external_sources SET last_status = ?, last_http_status = ?, last_note = ?, last_checked_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    status,
    result.status ?? null,
    note,
    t,
    t,
    id,
    workspaceId(),
  );
  audit("liveness_check", "external_source", id, { status, httpStatus: result.status ?? null });
  return { status, note };
}

/** 按事实汇总来源（报告用）。只统计已绑定的来源。 */
export function claimSourceSummaries(options: { brandId?: string } = {}): ClaimSourceSummary[] {
  const claims = all<{ id: string; claim_key: string; statement: string }>(
    `SELECT id, claim_key, statement FROM claims WHERE workspace_id = ? ${options.brandId ? "AND brand_id = ?" : ""} AND status = 'approved'`,
    ...(options.brandId ? [workspaceId(), options.brandId] : [workspaceId()]),
  );
  const rows = listExternalSources();
  return claims.map((c) => summarizeClaimSources({ id: c.id, key: c.claim_key, statement: c.statement }, rows.filter((r) => r.claim_id === c.id).map(rowToInput)));
}

/** 台账整体健康度：失效、冲突、超期未核对的数量 */
export function ledgerHealth(): { total: number; dead: number; mismatch: number; conflict: number; stale: number; neverChecked: number } {
  const rows = listExternalSources();
  let dead = 0, mismatch = 0, conflict = 0, stale = 0, neverChecked = 0;
  for (const row of rows) {
    const issues = checkExternalSource(rowToInput(row));
    if (issues.some((i) => i.code === "dead")) dead++;
    if (issues.some((i) => i.code === "mismatch")) mismatch++;
    if (issues.some((i) => i.code === "conflict")) conflict++;
    if (issues.some((i) => i.code === "stale_check")) stale++;
    if (issues.some((i) => i.code === "never_checked")) neverChecked++;
  }
  return { total: rows.length, dead, mismatch, conflict, stale, neverChecked };
}
