/**
 * 站点 robots 配置（纯数据，无任何依赖）。
 *
 * 单独抽出来的理由有两个：
 *  1. 可被单元测试直接导入，不需要 Next 的路径别名（`@/lib/site`）
 *  2. robots 规则里踩过一个真实坑，需要被测试长期守住：
 *     **具名 user-agent 组覆盖 `*` 组，而不是与之合并。**
 *     给检索型爬虫单独写一个 `Allow: /` 组，等于把 /console、/api/、/r/
 *     也对它们开放了。
 */

/** 全站禁止抓取的路径 */
export const DISALLOWED_PATHS = ["/console", "/console/", "/r/", "/api/"];

/** 公开可抓取路径 */
export const ALLOWED_PATHS = ["/", "/tools/", "/methods", "/knowledge/", "/stores/", "/brands/"];

/** 决定我们能否出现在 AI 答案里的检索型爬虫 */
export const SEARCH_BOTS = [
  "OAI-SearchBot",
  "PerplexityBot",
  "Claude-SearchBot",
  "Googlebot",
  "Bingbot",
  "DuckAssistBot",
];

/** 训练型爬虫。本站在此保持开放，但客户可自行决定。 */
export const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
];

export interface RobotsRule {
  userAgent: string | string[];
  allow: string[];
  disallow: string[];
}

/**
 * 生成 robots 规则。
 *
 * 三组规则的 allow/disallow 必须完全一致 —— 具名组不是"更宽松的例外"，
 * 只是把「允许检索型抓取」这件事写得更明确。
 */
export function robotsRules(): RobotsRule[] {
  return [
    { userAgent: "*", allow: ALLOWED_PATHS, disallow: DISALLOWED_PATHS },
    { userAgent: SEARCH_BOTS, allow: ALLOWED_PATHS, disallow: DISALLOWED_PATHS },
    { userAgent: TRAINING_BOTS, allow: ALLOWED_PATHS, disallow: DISALLOWED_PATHS },
  ];
}

/** 全部受保护路径的爬虫代理名（测试与自查共用，避免两处各写一份名单） */
export function allRobotsAgents(): string[] {
  return ["*", ...SEARCH_BOTS, ...TRAINING_BOTS];
}

/** 把规则渲染成 robots.txt 文本。用于测试与人工核对，不参与线上输出。 */
export function renderRobotsText(rules: RobotsRule[] = robotsRules()): string {
  const asArray = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);
  const lines: string[] = [];
  for (const rule of rules) {
    for (const ua of asArray(rule.userAgent)) lines.push(`User-agent: ${ua}`);
    for (const a of rule.allow) lines.push(`Allow: ${a}`);
    for (const d of rule.disallow) lines.push(`Disallow: ${d}`);
    lines.push("");
  }
  return lines.join("\n");
}
