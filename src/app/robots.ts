import type { MetadataRoute } from "next";
import { site, abs } from "@/lib/site";
import { robotsRules } from "@/lib/robots-config";

export const dynamic = "force-dynamic";

/**
 * 站点 robots：
 *  - 公开页面允许抓取，包括检索型 AI 爬虫（我们自己必须遵守同一套标准）
 *  - 运营台、API 与用户检查结果对**所有**爬虫一律禁止
 *
 * 规则本身放在 @/lib/robots-config（纯数据、可单测），这里只补 sitemap 与 host。
 * 注意具名 user-agent 组会覆盖 `*` 组，所以三组规则带着同样的 disallow ——
 * 曾经这里给检索型爬虫只写了 `Allow: /`，等于对它们开放了 /console 与 /api/。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: robotsRules(),
    sitemap: abs("/sitemap.xml"),
    host: site.baseUrl,
  };
}
