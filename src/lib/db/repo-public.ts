/**
 * 公开实体页的仓储层。
 *
 * 状态机刻意做窄：draft → in_review → published → archived。
 * 只有 published 能被公开路由读到；archived 表示曾公开但已下线，
 * 页面必须立刻 404，不能"悄悄还在"。
 */
import { getDb, workspaceId, audit } from "./index.ts";
import { newId, sha256 } from "../id.ts";
import {
  buildBrandSnapshot,
  buildStoreSnapshot,
  checkBrandPublishable,
  checkStorePublishable,
  decodeSlug,
  selectPublicFacts,
  slugifyEntity,
  type BrandSnapshot,
  type PublicBrandClaim,
  type PublicMapLink,
  type PublicSnapshot,
  type RawFact,
  type StoreSnapshot,
} from "../public-pages.ts";
import { listStoreFacts, listStoreHours, hoursToText, listMapListings, listMapDiffs, getStore } from "./repo-local.ts";
import { listClaims, listEvidences } from "./repo-domains.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const all = <T>(sql: string, ...a: any[]): T[] => getDb().prepare(sql).all(...a) as unknown as T[];
const one = <T>(sql: string, ...a: any[]): T | undefined => getDb().prepare(sql).get(...a) as unknown as T;
const run = (sql: string, ...a: any[]) => getDb().prepare(sql).run(...a);
const now = () => new Date().toISOString();

export interface PublicPageRow {
  id: string;
  entity_type: "brand" | "store";
  entity_id: string;
  slug: string;
  status: string;
  snapshot_json: string;
  snapshot_hash: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  archived_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function listPublicPages(entityType?: "brand" | "store"): PublicPageRow[] {
  const sql = `SELECT * FROM public_pages WHERE workspace_id = ? ${entityType ? "AND entity_type = ?" : ""} ORDER BY updated_at DESC`;
  return entityType ? all<PublicPageRow>(sql, workspaceId(), entityType) : all<PublicPageRow>(sql, workspaceId());
}

export function getPublicPageByEntity(entityType: "brand" | "store", entityId: string): PublicPageRow | undefined {
  return one<PublicPageRow>(
    "SELECT * FROM public_pages WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?",
    workspaceId(),
    entityType,
    entityId,
  );
}

/** 按 slug 取页面；路由段可能是百分号编码的中文，先解码再查 */
export function getPublicPageBySlug(slug: string): PublicPageRow | undefined {
  const decoded = decodeSlug(slug);
  return one<PublicPageRow>("SELECT * FROM public_pages WHERE slug = ?", decoded);
}

/** 只有已公开的页面能被匿名访问 —— 这条判断是 A2 的核心安全边界 */
export function getPublishedSnapshot(slug: string): { page: PublicPageRow; snapshot: PublicSnapshot } | undefined {
  const page = getPublicPageBySlug(slug);
  if (!page || page.status !== "published") return undefined;
  try {
    return { page, snapshot: JSON.parse(page.snapshot_json) as PublicSnapshot };
  } catch {
    return undefined;
  }
}

export function listPublishedPages(): PublicPageRow[] {
  return all<PublicPageRow>(
    "SELECT * FROM public_pages WHERE workspace_id = ? AND status = 'published' ORDER BY published_at DESC",
    workspaceId(),
  );
}

/* ------------------------------------------------------------------ *
 * 门店页
 * ------------------------------------------------------------------ */

function storeMapLinks(storeId: string): PublicMapLink[] {
  return listMapListings(storeId)
    .filter((l) => !!l.listing_url)
    .map((l) => ({ platform: l.platform, label: l.platform, url: l.listing_url! }));
}

function currentStoreSnapshot(storeId: string) {
  const store = getStore(storeId);
  if (!store) return null;
  const { visible } = selectPublicFacts(listStoreFacts(storeId) as RawFact[]);
  const hoursText = hoursToText(listStoreHours(storeId));
  const blockingMapDiffs = listMapDiffs({ storeId, onlyOpen: true }).filter((d) => d.severity === "block").length;
  const mapLinks = storeMapLinks(storeId);
  const check = checkStorePublishable({
    store: { status: store.status, address: store.address, name: store.name },
    visibleFacts: visible,
    hoursText,
    blockingMapDiffs,
    mapLinks,
  });
  const snapshot = buildStoreSnapshot({
    store: {
      name: store.name,
      city: store.city,
      district: store.district,
      address: store.address,
      category: store.category,
      service_radius_km: store.service_radius_km,
      status: store.status,
    },
    visibleFacts: visible,
    hoursText: hoursText || null,
    mapLinks,
    updatedAt: store.updated_at,
  });
  return { check, snapshot, store };
}

export interface StorePublishPreview {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  snapshot: StoreSnapshot | null;
  /** 已公开页面的快照与当前资料是否一致 */
  drift: boolean;
}

export function previewStorePage(storeId: string): StorePublishPreview {
  const cur = currentStoreSnapshot(storeId);
  if (!cur) return { ok: false, blockers: ["门店不存在"], warnings: [], snapshot: null, drift: false };
  const hash = sha256(JSON.stringify(cur.snapshot));
  const page = getPublicPageByEntity("store", storeId);
  return {
    ok: cur.check.ok,
    blockers: cur.check.blockers,
    warnings: cur.check.warnings,
    snapshot: cur.snapshot,
    drift: !!page && page.snapshot_hash !== null && page.snapshot_hash !== hash,
  };
}

/** 建立或刷新草稿页（不改状态，不公开） */
export function upsertStorePage(storeId: string): string {
  const cur = currentStoreSnapshot(storeId);
  if (!cur) throw new Error("门店不存在");
  const existing = getPublicPageByEntity("store", storeId);
  const slug = existing?.slug ?? slugifyEntity(cur.store.name, storeId);
  const hash = sha256(JSON.stringify(cur.snapshot));
  const t = now();
  if (existing) {
    run(
      "UPDATE public_pages SET snapshot_json = ?, snapshot_hash = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
      JSON.stringify(cur.snapshot),
      hash,
      t,
      existing.id,
      workspaceId(),
    );
    audit("snapshot_refresh", "public_page", existing.id, { storeId });
    return existing.id;
  }
  const id = newId("pubpage");
  run(
    `INSERT INTO public_pages (id, workspace_id, entity_type, entity_id, slug, status, snapshot_json, snapshot_hash, created_at, updated_at)
     VALUES (?, ?, 'store', ?, ?, 'draft', ?, ?, ?, ?)`,
    id,
    workspaceId(),
    storeId,
    slug,
    JSON.stringify(cur.snapshot),
    hash,
    t,
    t,
  );
  audit("create", "public_page", id, { storeId, slug });
  return id;
}

/* ------------------------------------------------------------------ *
 * 品牌页
 * ------------------------------------------------------------------ */

function publicBrandClaims(brandId: string): PublicBrandClaim[] {
  const today = now().slice(0, 10);
  return listClaims()
    .filter((c) => c.brand_id === brandId && c.status === "approved")
    .filter((c) => !(c.valid_until && c.valid_until < today))
    .filter((c) => !(c.valid_from && c.valid_from > today))
    .map((c) => ({
      key: c.claim_key,
      statement: c.statement,
      sources: listEvidences(c.id).map((e) => ({
        title: e.title,
        url: e.url ?? null,
        publisher: e.publisher ?? null,
        evidenceLevel: e.evidence_level,
      })),
    }));
}

export interface BrandPublishPreview {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  snapshot: BrandSnapshot | null;
  drift: boolean;
}

export function previewBrandPage(brandId: string): BrandPublishPreview {
  const brand = one<{ name: string; domain: string | null; description: string | null; updated_at: string }>(
    "SELECT name, domain, description, updated_at FROM brands WHERE id = ? AND workspace_id = ?",
    brandId,
    workspaceId(),
  );
  if (!brand) return { ok: false, blockers: ["品牌不存在"], warnings: [], snapshot: null, drift: false };
  const claims = publicBrandClaims(brandId);
  const check = checkBrandPublishable({
    brand: { name: brand.name, domain: brand.domain, description: brand.description },
    claims: claims.map((c) => ({ key: c.key, statement: c.statement, evidences: c.sources })),
  });
  const snapshot = buildBrandSnapshot({
    brand: { name: brand.name, domain: brand.domain, description: brand.description },
    claims,
    updatedAt: brand.updated_at,
  });
  const hash = sha256(JSON.stringify(snapshot));
  const page = getPublicPageByEntity("brand", brandId);
  return {
    ok: check.ok,
    blockers: check.blockers,
    warnings: check.warnings,
    snapshot,
    drift: !!page && page.snapshot_hash !== null && page.snapshot_hash !== hash,
  };
}

export function upsertBrandPage(brandId: string): string {
  const preview = previewBrandPage(brandId);
  if (!preview.snapshot) throw new Error("品牌不存在");
  const existing = getPublicPageByEntity("brand", brandId);
  const slug = existing?.slug ?? slugifyEntity(preview.snapshot.name, brandId);
  const hash = sha256(JSON.stringify(preview.snapshot));
  const t = now();
  if (existing) {
    run(
      "UPDATE public_pages SET snapshot_json = ?, snapshot_hash = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
      JSON.stringify(preview.snapshot),
      hash,
      t,
      existing.id,
      workspaceId(),
    );
    audit("snapshot_refresh", "public_page", existing.id, { brandId });
    return existing.id;
  }
  const id = newId("pubpage");
  run(
    `INSERT INTO public_pages (id, workspace_id, entity_type, entity_id, slug, status, snapshot_json, snapshot_hash, created_at, updated_at)
     VALUES (?, ?, 'brand', ?, ?, 'draft', ?, ?, ?, ?)`,
    id,
    workspaceId(),
    brandId,
    slug,
    JSON.stringify(preview.snapshot),
    hash,
    t,
    t,
  );
  audit("create", "public_page", id, { brandId, slug });
  return id;
}

/* ------------------------------------------------------------------ *
 * 状态流转
 * ------------------------------------------------------------------ */

/** 前提检查必须在这里再跑一次 —— 界面上过了不代表现在还能过 */
function assertPublishable(page: PublicPageRow): void {
  if (page.entity_type === "store") {
    const preview = previewStorePage(page.entity_id);
    if (!preview.ok) throw new Error(`发布前检查未通过：${preview.blockers.join("；")}`);
  } else {
    const preview = previewBrandPage(page.entity_id);
    if (!preview.ok) throw new Error(`发布前检查未通过：${preview.blockers.join("；")}`);
  }
}

/**
 * 刷新快照并进入待审核。
 *
 * 关键：快照在此刻固化。审核通过后即使门店资料改了，已公开页面也不会
 * 静默变化 —— 否则"已审核"这个状态就没有意义。
 */
export function submitForReview(id: string): void {
  const page = one<PublicPageRow>("SELECT * FROM public_pages WHERE id = ? AND workspace_id = ?", id, workspaceId());
  if (!page) throw new Error("公开页不存在");
  if (!["draft", "archived", "in_review"].includes(page.status)) throw new Error("当前状态不能提交审核");

  const preview = page.entity_type === "store" ? previewStorePage(page.entity_id) : previewBrandPage(page.entity_id);
  if (!preview.snapshot) throw new Error("无法生成内容快照");
  const hash = sha256(JSON.stringify(preview.snapshot));
  run(
    "UPDATE public_pages SET snapshot_json = ?, snapshot_hash = ?, status = 'in_review', updated_at = ? WHERE id = ? AND workspace_id = ?",
    JSON.stringify(preview.snapshot),
    hash,
    now(),
    id,
    workspaceId(),
  );
  audit("submit_review", "public_page", id, { blockers: preview.blockers, warnings: preview.warnings });
}

export function publishPage(id: string, reviewer = "operator"): void {
  const page = one<PublicPageRow>("SELECT * FROM public_pages WHERE id = ? AND workspace_id = ?", id, workspaceId());
  if (!page) throw new Error("公开页不存在");
  if (page.status === "published") return;
  assertPublishable(page);
  const t = now();
  run(
    "UPDATE public_pages SET status = 'published', reviewed_by = ?, reviewed_at = ?, published_at = COALESCE(published_at, ?), archived_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?",
    reviewer,
    t,
    t,
    t,
    id,
    workspaceId(),
  );
  audit("publish", "public_page", id, { reviewer, slug: page.slug });
}

export function archivePage(id: string, reason: string): void {
  const t = now();
  run(
    "UPDATE public_pages SET status = 'archived', archived_at = ?, note = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    t,
    reason || null,
    t,
    id,
    workspaceId(),
  );
  audit("archive", "public_page", id, { reason });
}

export function deletePage(id: string): void {
  run("DELETE FROM public_pages WHERE id = ? AND workspace_id = ?", id, workspaceId());
  audit("delete", "public_page", id, {});
}
