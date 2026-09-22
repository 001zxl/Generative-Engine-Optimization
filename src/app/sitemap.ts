import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";
import { listPublishedKnowledge } from "@/lib/publishing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * sitemap 只包含稳定公开页。
 * 用户检查结果页（/r/[id]）永不进入 sitemap —— 它们默认不被索引（但持链接可访问）。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: abs("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: abs("/tools/ai-crawler-check"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: abs("/tools/citation-readiness"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: abs("/methods"), lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: abs("/knowledge"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    ...listPublishedKnowledge().map((article) => ({ url: article.url, lastModified: new Date(article.publishedAt), changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
