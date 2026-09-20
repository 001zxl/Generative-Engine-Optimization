import type { MetadataRoute } from "next";
import { site, abs } from "@/lib/site";

/**
 * 站点 robots：
 *  - 公开页面允许抓取，包括检索型 AI 爬虫（我们自己必须遵守同一套标准）
 *  - 运营台与用户检查结果默认禁止索引
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/tools/", "/methods"],
        disallow: ["/console", "/console/", "/r/", "/api/"],
      },
      // 显式放行检索型 AI 爬虫：决定我们能否出现在 AI 答案里
      { userAgent: ["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Googlebot", "Bingbot", "DuckAssistBot"], allow: "/" },
      // 训练型爬虫：本站在此保持开放，但客户可自行决定
      { userAgent: ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Applebot-Extended", "meta-externalagent"], allow: "/" },
    ],
    sitemap: abs("/sitemap.xml"),
    host: site.baseUrl,
  };
}
