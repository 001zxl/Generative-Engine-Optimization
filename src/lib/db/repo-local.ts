/**
 * 本地门店 GEO 的仓储层（门店 / 营业时间 / 事实 / 地图资料 / 锚点 / 场景）。
 *
 * 与 repo-domains.ts 分开，避免单文件过长；沿用同一套约定：
 * SQL 集中在此、写入带 workspace_id、关键操作写审计。
 *
 * ⚠️ 本文件**没有任何写回第三方地图平台的路径** —— 地图资料只做授权查询后的快照
 *    保存与差异记录，修正动作由人工在平台侧完成后回填处理结果。
 */
import { getDb, workspaceId, audit } from "./index.ts";
import { newId } from "../id.ts";
import { computeListingDiffs, type ExpectedFacts, type ListingDiff } from "../local-geo.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const all = <T>(sql: string, ...a: any[]): T[] => getDb().prepare(sql).all(...a) as unknown as T[];
const one = <T>(sql: string, ...a: any[]): T | undefined => getDb().prepare(sql).get(...a) as unknown as T;
const run = (sql: string, ...a: any[]) => getDb().prepare(sql).run(...a);
const now = () => new Date().toISOString();

/* =====================================================================
 * 门店
 * ===================================================================== */

export interface StoreRow {
  id: string;
  brand_id: string | null;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  status: string;
  service_radius_km: number | null;
  timezone: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  fact_count?: number;
  listing_count?: number;
  open_diff_count?: number;
}

export function listStores(): StoreRow[] {
  return all<StoreRow>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM store_facts f WHERE f.store_id = s.id) AS fact_count,
       (SELECT COUNT(*) FROM map_listings m WHERE m.store_id = s.id) AS listing_count,
       (SELECT COUNT(*) FROM map_listing_diffs d
          JOIN map_listings m2 ON m2.id = d.listing_id
         WHERE m2.store_id = s.id AND d.status IN ('open','in_progress')) AS open_diff_count
     FROM stores s WHERE s.workspace_id = ? ORDER BY s.created_at DESC`,
    workspaceId(),
  );
}

export function getStore(id: string): StoreRow | undefined {
  return one<StoreRow>("SELECT * FROM stores WHERE id = ? AND workspace_id = ?", id, workspaceId());
}

export function createStore(input: {
  name: string;
  brandId?: string | null;
  code?: string;
  address?: string;
  city?: string;
  district?: string;
  lat?: number;
  lng?: number;
  category?: string;
  status?: string;
  serviceRadiusKm?: number;
}): string {
  const id = newId("store");
  const t = now();
  run(
    `INSERT INTO stores (id, workspace_id, brand_id, name, code, address, city, district, lat, lng,
       category, status, service_radius_km, timezone, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Shanghai', NULL, ?, ?)`,
    id,
    workspaceId(),
    input.brandId ?? null,
    input.name,
    input.code ?? null,
    input.address ?? null,
    input.city ?? null,
    input.district ?? null,
    input.lat ?? null,
    input.lng ?? null,
    input.category ?? null,
    input.status ?? "unverified",
    input.serviceRadiusKm ?? null,
    t,
    t,
  );
  audit("create", "store", id, { name: input.name, city: input.city });
  return id;
}

export function updateStore(id: string, patch: Partial<Omit<StoreRow, "id" | "created_at" | "updated_at">>): void {
  const cur = getStore(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  run(
    `UPDATE stores SET name=?, code=?, address=?, city=?, district=?, lat=?, lng=?, category=?,
       status=?, service_radius_km=?, note=?, updated_at=? WHERE id=? AND workspace_id=?`,
    next.name,
    next.code ?? null,
    next.address ?? null,
    next.city ?? null,
    next.district ?? null,
    next.lat ?? null,
    next.lng ?? null,
    next.category ?? null,
    next.status,
    next.service_radius_km ?? null,
    next.note ?? null,
    now(),
    id,
    workspaceId(),
  );
  audit("update", "store", id, patch as Record<string, unknown>);
}

export function deleteStore(id: string): void {
  run("DELETE FROM stores WHERE id = ? AND workspace_id = ?", id, workspaceId());
  audit("delete", "store", id);
}

/* =====================================================================
 * 营业时间（周表）
 * ===================================================================== */

export interface StoreHourRow {
  id: string;
  store_id: string;
  weekday: number;
  closed: number;
  opens: string | null;
  closes: string | null;
  note: string | null;
}

export function listStoreHours(storeId: string): StoreHourRow[] {
  return all<StoreHourRow>("SELECT * FROM store_hours WHERE store_id = ? ORDER BY weekday", storeId);
}

/** 整周覆盖式保存（界面一次提交 7 天），避免逐行增删产生脏数据 */
export function setStoreHours(
  storeId: string,
  rows: Array<{ weekday: number; closed: boolean; opens?: string; closes?: string }>,
): void {
  const db = getDb();
  db.prepare("DELETE FROM store_hours WHERE store_id = ?").run(storeId);
  const stmt = db.prepare(
    "INSERT INTO store_hours (id, store_id, weekday, closed, opens, closes, note, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
  );
  const t = now();
  for (const r of rows) {
    stmt.run(newId("sh"), storeId, r.weekday, r.closed ? 1 : 0, r.opens ?? null, r.closes ?? null, t);
  }
  audit("set_hours", "store", storeId, { days: rows.length });
}

/** 把周表压成一行可读文本，用于和地图平台上的营业时间做比对 */
export function hoursToText(rows: StoreHourRow[]): string {
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return rows
    .map((r) => `${names[r.weekday]} ${r.closed ? "休息" : `${r.opens ?? "?"}-${r.closes ?? "?"}`}`)
    .join("; ");
}

/* =====================================================================
 * 门店事实（每条强制来源与核验日期）
 * ===================================================================== */

export interface StoreFactRow {
  id: string;
  store_id: string;
  fact_key: string;
  value: string;
  status: string;
  source_kind: string;
  source_url: string | null;
  source_title: string | null;
  verified_at: string | null;
  valid_until: string | null;
  note: string | null;
  created_at: string;
}

export function listStoreFacts(storeId: string): StoreFactRow[] {
  return all<StoreFactRow>(
    "SELECT * FROM store_facts WHERE store_id = ? ORDER BY fact_key, created_at DESC",
    storeId,
  );
}

export function addStoreFact(input: {
  storeId: string;
  factKey: string;
  value: string;
  sourceKind?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  verifiedAt?: string;
  validUntil?: string;
  note?: string;
  status?: string;
}): string {
  const id = newId("sfact");
  // 未给核验日期时状态强制为 draft —— 没有依据的事实不能算已核验
  const status = input.verifiedAt ? (input.status ?? "verified") : "draft";
  run(
    `INSERT INTO store_facts (id, workspace_id, store_id, fact_key, value, status, source_kind,
       source_url, source_title, verified_at, valid_until, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    workspaceId(),
    input.storeId,
    input.factKey,
    input.value,
    status,
    input.sourceKind ?? "self",
    input.sourceUrl ?? null,
    input.sourceTitle ?? null,
    input.verifiedAt ?? null,
    input.validUntil ?? null,
    input.note ?? null,
    now(),
  );
  audit("create", "store_fact", id, { storeId: input.storeId, factKey: input.factKey });
  return id;
}

/** 核验一条事实：写入核验日期并置为已核验（这是"有依据"的唯一入口） */
export function verifyStoreFact(id: string, sourceUrl?: string, verifiedAt?: string): void {
  run(
    "UPDATE store_facts SET status = 'verified', verified_at = ?, source_url = COALESCE(?, source_url) WHERE id = ? AND workspace_id = ?",
    verifiedAt ?? now().slice(0, 10),
    sourceUrl ?? null,
    id,
    workspaceId(),
  );
  audit("verify", "store_fact", id, { verifiedAt: verifiedAt ?? now().slice(0, 10) });
}

export function setStoreFactStatus(id: string, status: string): void {
  run("UPDATE store_facts SET status = ? WHERE id = ? AND workspace_id = ?", status, id, workspaceId());
  audit("set_status", "store_fact", id, { status });
}

export function deleteStoreFact(id: string): void {
  run("DELETE FROM store_facts WHERE id = ? AND workspace_id = ?", id, workspaceId());
}

/** 取「每个 fact_key 的最新一条」，用于与地图资料比对 */
export function latestFactByKey(storeId: string): Record<string, StoreFactRow> {
  const out: Record<string, StoreFactRow> = {};
  for (const f of listStoreFacts(storeId)) {
    if (!out[f.fact_key]) out[f.fact_key] = f; // 已按 created_at DESC 排序
  }
  return out;
}

/* =====================================================================
 * 地图资料
 * ===================================================================== */

export interface MapListingRow {
  id: string;
  store_id: string;
  platform: string;
  poi_id: string | null;
  listing_url: string | null;
  claim_status: string;
  seen_name: string | null;
  seen_address: string | null;
  seen_phone: string | null;
  seen_hours: string | null;
  seen_category: string | null;
  snapshot_at: string | null;
  query_method: string;
  note: string | null;
  updated_at: string;
}

export function listMapListings(storeId: string): MapListingRow[] {
  return all<MapListingRow>("SELECT * FROM map_listings WHERE store_id = ? ORDER BY platform", storeId);
}

export function upsertMapListing(input: {
  storeId: string;
  platform: string;
  poiId?: string;
  listingUrl?: string;
  claimStatus?: string;
  queryMethod?: string;
  note?: string;
}): string {
  const existing = one<{ id: string }>(
    "SELECT id FROM map_listings WHERE store_id = ? AND platform = ?",
    input.storeId,
    input.platform,
  );
  const t = now();
  if (existing) {
    run(
      `UPDATE map_listings SET poi_id = COALESCE(?, poi_id), listing_url = COALESCE(?, listing_url),
         claim_status = COALESCE(?, claim_status), query_method = COALESCE(?, query_method),
         note = COALESCE(?, note), updated_at = ? WHERE id = ?`,
      input.poiId ?? null,
      input.listingUrl ?? null,
      input.claimStatus ?? null,
      input.queryMethod ?? null,
      input.note ?? null,
      t,
      existing.id,
    );
    return existing.id;
  }
  const id = newId("mlist");
  run(
    `INSERT INTO map_listings (id, workspace_id, store_id, platform, poi_id, listing_url, claim_status,
       query_method, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    workspaceId(),
    input.storeId,
    input.platform,
    input.poiId ?? null,
    input.listingUrl ?? null,
    input.claimStatus ?? "unknown",
    input.queryMethod ?? "authorized_lookup",
    input.note ?? null,
    t,
    t,
  );
  audit("create", "map_listing", id, { storeId: input.storeId, platform: input.platform });
  return id;
}

export interface DiffSaveResult {
  snapshotAt: string;
  diffs: ListingDiff[];
  created: number;
  resolvedStale: number;
}

/**
 * 保存一次授权查询的观测快照，并据此生成/收敛差异待办。
 *
 * 语义：
 *  - 新出现的不一致 → 新建 open 待办
 *  - 已经不在不一致列表里的 open 待办 → 自动标为 resolved（平台侧已一致）
 *  - **不自动修改任何第三方资料**
 */
export function saveListingSnapshot(input: {
  listingId: string;
  snapshot: {
    name?: string;
    address?: string;
    phone?: string;
    hours?: string;
    category?: string;
  };
  snapshotAt?: string;
}): DiffSaveResult {
  const db = getDb();
  const listing = one<MapListingRow>(
    "SELECT * FROM map_listings WHERE id = ? AND workspace_id = ?",
    input.listingId,
    workspaceId(),
  );
  if (!listing) throw new Error("地图资料不存在");

  const t = input.snapshotAt ?? now();
  run(
    `UPDATE map_listings SET seen_name=?, seen_address=?, seen_phone=?, seen_hours=?, seen_category=?,
       snapshot_at=?, updated_at=? WHERE id = ?`,
    input.snapshot.name ?? null,
    input.snapshot.address ?? null,
    input.snapshot.phone ?? null,
    input.snapshot.hours ?? null,
    input.snapshot.category ?? null,
    t,
    now(),
    input.listingId,
  );

  // 期望值以"门店档案 + 已核验事实"为准
  const store = getStore(listing.store_id);
  const facts = latestFactByKey(listing.store_id);
  const hours = hoursToText(listStoreHours(listing.store_id));
  const expected: ExpectedFacts = {
    name: facts.name?.value ?? store?.name ?? null,
    address: facts.address?.value ?? store?.address ?? null,
    phone: facts.phone?.value ?? null,
    hours: hours || facts.hours_regular?.value || null,
    category: facts.category?.value ?? store?.category ?? null,
  };
  const seen = {
    seen_name: input.snapshot.name,
    seen_address: input.snapshot.address,
    seen_phone: input.snapshot.phone,
    seen_hours: input.snapshot.hours,
    seen_category: input.snapshot.category,
  };
  const diffs = computeListingDiffs(expected, seen);

  const openExisting = all<{ id: string; field: string }>(
    "SELECT id, field FROM map_listing_diffs WHERE listing_id = ? AND status IN ('open','in_progress')",
    input.listingId,
  );
  let created = 0;
  for (const d of diffs) {
    if (openExisting.some((e) => e.field === d.field)) {
      run(
        "UPDATE map_listing_diffs SET seen_value = ?, expected_value = ? WHERE listing_id = ? AND field = ? AND status IN ('open','in_progress')",
        d.seen,
        d.expected,
        input.listingId,
        d.field,
      );
      continue;
    }
    run(
      `INSERT INTO map_listing_diffs (id, workspace_id, listing_id, field, expected_value, seen_value,
         severity, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      newId("mdiff"),
      workspaceId(),
      input.listingId,
      d.field,
      d.expected,
      d.seen,
      d.severity,
      now(),
    );
    created++;
  }

  // 不再不一致的 open 待办 → 自动收敛
  const stillBad = new Set(diffs.map((d) => d.field));
  let resolvedStale = 0;
  for (const e of openExisting) {
    if (!stillBad.has(e.field as ListingDiff["field"])) {
      run(
        "UPDATE map_listing_diffs SET status='resolved', resolved_at=?, resolution_note=COALESCE(resolution_note, '平台侧资料已与核验事实一致（自动收敛）') WHERE id=?",
        now(),
        e.id,
      );
      resolvedStale++;
    }
  }

  audit("snapshot", "map_listing", input.listingId, { created, resolvedStale });
  return { snapshotAt: t, diffs, created, resolvedStale };
}

export interface MapDiffRow {
  id: string;
  listing_id: string;
  field: string;
  expected_value: string | null;
  seen_value: string | null;
  severity: string;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  platform?: string;
  store_name?: string;
}

export function listMapDiffs(opts: { storeId?: string; onlyOpen?: boolean } = {}): MapDiffRow[] {
  const where = ["d.workspace_id = ?"];
  const args: unknown[] = [workspaceId()];
  if (opts.storeId) {
    where.push("m.store_id = ?");
    args.push(opts.storeId);
  }
  if (opts.onlyOpen) where.push("d.status IN ('open','in_progress')");
  return all<MapDiffRow>(
    `SELECT d.*, m.platform, s.name AS store_name
     FROM map_listing_diffs d
     JOIN map_listings m ON m.id = d.listing_id
     JOIN stores s ON s.id = m.store_id
     WHERE ${where.join(" AND ")}
     ORDER BY CASE d.severity WHEN 'block' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, d.created_at DESC`,
    ...args,
  );
}

/**
 * 记录一条差异的人工处理结果。
 * 修正动作发生在第三方平台侧（人工完成），这里只记录"怎么处理的"。
 */
export function resolveMapDiff(id: string, status: string, note: string): void {
  const t = now();
  run(
    "UPDATE map_listing_diffs SET status = ?, resolution_note = ?, resolved_at = ? WHERE id = ? AND workspace_id = ?",
    status,
    note || null,
    status === "resolved" || status === "accepted" ? t : null,
    id,
    workspaceId(),
  );
  audit("resolve", "map_listing_diff", id, { status, note });
}

/* =====================================================================
 * 测试锚点与地理场景
 * ===================================================================== */

export interface GeoAnchorRow {
  id: string;
  store_id: string | null;
  name: string;
  kind: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  note: string | null;
  created_at: string;
}

export function listAnchors(storeId?: string): GeoAnchorRow[] {
  return storeId
    ? all<GeoAnchorRow>("SELECT * FROM geo_anchors WHERE workspace_id = ? AND store_id = ? ORDER BY created_at", workspaceId(), storeId)
    : all<GeoAnchorRow>("SELECT * FROM geo_anchors WHERE workspace_id = ? ORDER BY created_at", workspaceId());
}

export function createAnchor(input: {
  storeId?: string | null;
  name: string;
  kind?: string;
  lat?: number;
  lng?: number;
  address?: string;
  note?: string;
}): string {
  const id = newId("anchor");
  run(
    `INSERT INTO geo_anchors (id, workspace_id, store_id, name, kind, lat, lng, address, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    workspaceId(),
    input.storeId ?? null,
    input.name,
    input.kind ?? "landmark",
    input.lat ?? null,
    input.lng ?? null,
    input.address ?? null,
    input.note ?? null,
    now(),
  );
  audit("create", "geo_anchor", id, { name: input.name });
  return id;
}

export function deleteAnchor(id: string): void {
  run("DELETE FROM geo_anchors WHERE id = ? AND workspace_id = ?", id, workspaceId());
}

export interface GeoScenarioRow {
  id: string;
  store_id: string;
  anchor_id: string | null;
  radius_m: number;
  daypart: string;
  need: string | null;
  competitor_store_ids: string;
  expected_note: string | null;
  status: string;
  created_at: string;
  anchor_name?: string | null;
}

export function listScenarios(storeId?: string): GeoScenarioRow[] {
  const sql = `SELECT g.*, a.name AS anchor_name FROM geo_scenarios g
    LEFT JOIN geo_anchors a ON a.id = g.anchor_id
    WHERE g.workspace_id = ? ${storeId ? "AND g.store_id = ?" : ""}
    ORDER BY g.created_at DESC`;
  return storeId ? all<GeoScenarioRow>(sql, workspaceId(), storeId) : all<GeoScenarioRow>(sql, workspaceId());
}

export function createScenario(input: {
  storeId: string;
  anchorId?: string | null;
  radiusM?: number;
  daypart?: string;
  need?: string;
  competitorStoreIds?: string[];
  expectedNote?: string;
}): string {
  const id = newId("gscen");
  run(
    `INSERT INTO geo_scenarios (id, workspace_id, store_id, anchor_id, radius_m, daypart, need,
       competitor_store_ids, expected_note, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    id,
    workspaceId(),
    input.storeId,
    input.anchorId ?? null,
    input.radiusM ?? 1000,
    input.daypart ?? "any",
    input.need ?? null,
    JSON.stringify(input.competitorStoreIds ?? []),
    input.expectedNote ?? null,
    now(),
  );
  audit("create", "geo_scenario", id, { storeId: input.storeId });
  return id;
}

export function deleteScenario(id: string): void {
  run("DELETE FROM geo_scenarios WHERE id = ? AND workspace_id = ?", id, workspaceId());
}

/** 门店是否具备"可开始位置采样"的最低条件 */
export function storeReadiness(storeId: string): {
  factsTotal: number;
  factsVerified: number;
  listings: number;
  claimed: number;
  anchors: number;
  scenarios: number;
  openDiffs: number;
  blockers: string[];
} {
  const facts = listStoreFacts(storeId);
  const verified = facts.filter((f) => f.status === "verified" && f.verified_at);
  const listings = listMapListings(storeId);
  const claimed = listings.filter((l) => l.claim_status === "claimed_by_us");
  const anchors = listAnchors(storeId);
  const scenarios = listScenarios(storeId);
  const openDiffs = listMapDiffs({ storeId, onlyOpen: true });

  const blockers: string[] = [];
  if (facts.length === 0) blockers.push("还没有任何门店事实");
  if (verified.length === 0) blockers.push("没有已核验的事实 —— 无法判断平台资料对不对");
  if (listings.length === 0) blockers.push("还没有登记任何地图平台资料");
  if (claimed.length === 0) blockers.push("没有已认领的平台资料 —— 无法保证资料可维护");
  if (anchors.length === 0) blockers.push("还没有测试锚点");
  if (scenarios.length === 0) blockers.push("还没有地理测试场景");
  if (openDiffs.some((d) => d.severity === "block")) blockers.push("存在阻断级资料差异（店名/地址不一致）");

  return {
    factsTotal: facts.length,
    factsVerified: verified.length,
    listings: listings.length,
    claimed: claimed.length,
    anchors: anchors.length,
    scenarios: scenarios.length,
    openDiffs: openDiffs.length,
    blockers,
  };
}


/* ------------------------------------------------------------------ *
 * 门店级报告取数
 * ------------------------------------------------------------------ */

/**
 * 取某个批次里事实类评测的原始判定。
 *
 * 只读 evaluation_results，不重算 —— 报告必须复现评测当时的结论，
 * 否则「前后对比口径一致」这条验收标准就不成立。
 */
export function listFactEvalsForRun(runId: string): Array<{ verdict: "consistent" | "conflict" | "unknown" }> {
  const rows = all<{ result_json: string }>(
    `SELECT e.result_json FROM evaluation_results e
       JOIN response_samples s ON s.id = e.sample_id
      WHERE e.workspace_id = ? AND e.evaluator = 'facts' AND s.run_id = ?`,
    workspaceId(),
    runId,
  );
  const out: Array<{ verdict: "consistent" | "conflict" | "unknown" }> = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.result_json) as Array<{ verdict?: string }>;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        const v = item?.verdict;
        if (v === "consistent" || v === "conflict" || v === "unknown") out.push({ verdict: v });
      }
    } catch {
      // 坏 JSON 直接跳过：宁可少算，也不能把解析失败当成「一致」
    }
  }
  return out;
}

/** 门店维度的批次列表，按定位方式分开返回 —— 不同定位方式的样本永不合并。 */
export function listRunsByLocationMode(storeId: string): Array<{ locationMode: string; runs: Array<{ id: string; label: string; created_at: string; sample_count: number }> }> {
  const rows = all<{ id: string; label: string; created_at: string; location_mode: string | null; sample_count: number }>(
    `SELECT r.id, r.label, r.created_at, r.location_mode,
            (SELECT COUNT(*) FROM response_samples s WHERE s.run_id = r.id) AS sample_count
       FROM sampling_runs r
      WHERE r.workspace_id = ? AND r.store_id = ?
      ORDER BY r.created_at ASC`,
    workspaceId(),
    storeId,
  );
  const groups = new Map<string, Array<{ id: string; label: string; created_at: string; sample_count: number }>>();
  for (const r of rows) {
    const mode = r.location_mode ?? "unspecified";
    const list = groups.get(mode) ?? [];
    list.push({ id: r.id, label: r.label, created_at: r.created_at, sample_count: r.sample_count });
    groups.set(mode, list);
  }
  return [...groups.entries()].map(([locationMode, runs]) => ({ locationMode, runs }));
}

/** 门店线索数。未回填 store_id 的历史线索不计入任何门店，也不摊派。 */
export function countLeadsForStore(storeId: string): { total: number; byStatus: Array<{ status: string; n: number }> } {
  const total = one<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE workspace_id = ? AND store_id = ?", workspaceId(), storeId)?.n ?? 0;
  const byStatus = all<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM leads WHERE workspace_id = ? AND store_id = ? GROUP BY status ORDER BY n DESC",
    workspaceId(),
    storeId,
  );
  return { total, byStatus };
}
