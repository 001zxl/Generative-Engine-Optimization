/**
 * 静态导出的取数层。
 *
 * **只取已公开内容**：门店/品牌页要求 `public_pages.status='published'`，
 * 文章要求存在成功的 own_site 发布记录。草稿、待审核、已下线一律不取 ——
 * 这是"运营台里出现过的内容不会自动公开"在导出路径上的同一道闸。
 */
import { getDb, workspaceId } from "./index.ts";
import { listPublishedPages } from "./repo-public.ts";
import { listPublishedKnowledge } from "../publishing.ts";
import { decodeSlug, type BrandSnapshot, type StoreSnapshot } from "../public-pages.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const all = <T>(sql: string, ...a: any[]): T[] => getDb().prepare(sql).all(...a) as unknown as T[];

export interface ExportPage {
  entityType: "store" | "brand";
  slug: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string;
  snapshot: StoreSnapshot | BrandSnapshot;
}

/** 已公开的实体页（门店 / 品牌） */
export function collectPublishedPages(): ExportPage[] {
  const rows = listPublishedPages();
  const out: ExportPage[] = [];
  for (const row of rows) {
    try {
      const snapshot = JSON.parse(row.snapshot_json) as StoreSnapshot | BrandSnapshot;
      // 双重校验：状态必须是 published，且快照类型与记录类型一致
      if (row.status !== "published") continue;
      if (snapshot.kind !== row.entity_type) continue;
      out.push({
        entityType: row.entity_type,
        slug: decodeSlug(row.slug),
        status: row.status,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
        snapshot,
      });
    } catch {
      // 坏快照跳过：宁可少导一个页面，也不能把解析失败当成内容发出去
    }
  }
  return out;
}

export interface ExportArticle {
  slug: string;
  title: string;
  body: string;
  author: string;
  publishedAt: string;
  url: string;
  evidences: Array<{ title: string; url: string; publisher: string | null; evidenceLevel: string }>;
}

/** 已发布的知识页文章 */
export function collectPublishedArticles(): ExportArticle[] {
  return listPublishedKnowledge().map((a) => ({
    slug: a.slug,
    title: a.title,
    body: a.body,
    author: a.author,
    publishedAt: a.publishedAt,
    url: a.url,
    evidences: a.evidences,
  }));
}

/** 导出前的体检：能导出什么、少了什么、被跳过了什么 */
export interface ExportPreflight {
  pages: { total: number; stores: number; brands: number };
  articles: number;
  /** 未公开因而不会被导出的对象，逐条说明原因 */
  excluded: Array<{ kind: string; name: string; status: string; reason: string }>;
  warnings: string[];
}

export function exportPreflight(): ExportPreflight {
  const pages = collectPublishedPages();
  const articles = collectPublishedArticles();

  // 列出所有非 published 的页面记录，让运营知道"为什么这个没被导出"
  const pending = all<{ entity_type: string; entity_id: string; status: string }>(
    "SELECT entity_type, entity_id, status FROM public_pages WHERE workspace_id = ? AND status <> 'published'",
    workspaceId(),
  );
  const excluded: ExportPreflight["excluded"] = [];
  for (const p of pending) {
    const name =
      p.entity_type === "store"
        ? (all<{ name: string }>("SELECT name FROM stores WHERE id = ?", p.entity_id)[0]?.name ?? p.entity_id)
        : (all<{ name: string }>("SELECT name FROM brands WHERE id = ?", p.entity_id)[0]?.name ?? p.entity_id);
    excluded.push({
      kind: p.entity_type,
      name,
      status: p.status,
      reason:
        p.status === "draft"
          ? "还是草稿 —— 未提交审核"
          : p.status === "in_review"
            ? "待审核 —— 审核通过并公开后才会导出"
            : "已下线 —— 不会出现在导出物里",
    });
  }

  const warnings: string[] = [];
  if (pages.length + articles.length === 0) {
    warnings.push("没有任何已公开内容，导出物将只有一个空索引页");
  }
  if (excluded.length > 0) {
    warnings.push(`${excluded.length} 个对象未公开，不会出现在导出物里`);
  }
  const missingLd = pages.filter((p) => !p.snapshot).length;
  if (missingLd > 0) warnings.push(`${missingLd} 个页面快照无法解析，已跳过`);

  return {
    pages: { total: pages.length, stores: pages.filter((p) => p.entityType === "store").length, brands: pages.filter((p) => p.entityType === "brand").length },
    articles: articles.length,
    excluded,
    warnings,
  };
}
