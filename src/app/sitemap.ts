import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";
import { listPublishedKnowledge } from "@/lib/publishing";
import { listPublishedPages } from "@/lib/db/repo-public";
import { publicPath } from "@/lib/public-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * sitemap 只包含稳定公开页。
 * 用户检查结果页（/r/[id]）永不进入 sitemap —— 它们默认不被索引（但持链接可访问）。
 *
 * 实体页只收 status='published' 的：草稿与已下线页面不出现在 sitemap，
 * 也不能被匿名访问 —— 两处判断用的是同一个状态字段。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: abs("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: abs("/tools/ai-crawler-check"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: abs("/tools/citation-readiness"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: abs("/methods"), lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: abs("/knowledge"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    ...listPublishedKnowledge().map((article) => ({
      url: article.url,
      lastModified: new Date(article.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...listPublishedPages().map((page) => ({
      url: abs(publicPath(page.entity_type, page.slug)),
      lastModified: new Date(page.published_at ?? page.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
