/**
 * robots.txt 解析与匹配（RFC 9309）
 *
 * 这是免费工具 A 的核心。刻意自己实现而不引第三方库，因为要保证：
 *  - 匹配规则可解释（结果页要展示"依据哪一条规则判定"）
 *  - 支持通配符 * 与结尾锚定 $
 *  - 最长匹配优先，同长度 Allow 优先
 */

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
  raw: string | null;
  error?: string;
}

export interface RobotsVerdict {
  allowed: boolean;
  /** 命中的 user-agent 组（用于展示依据） */
  matchedAgent: string;
  /** 命中的具体规则；null 表示没有任何规则命中 */
  matchedRule: RobotsRule | null;
  /** 判定的可解释说明 */
  reason: string;
}

const EMPTY: ParsedRobots = { groups: [], sitemaps: [], raw: null };

export function parseRobots(text: string | null, error?: string): ParsedRobots {
  if (text === null) return { ...EMPTY, error };

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let pendingAgents: string[] = [];
  let current: RobotsGroup | null = null;

  const commit = () => {
    if (current && current.agents.length > 0) groups.push(current);
    current = null;
    pendingAgents = [];
  };

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      // 出现新的 user-agent 且上一组已有规则 => 上一组结束
      if (current && (current.rules.length > 0 || current.crawlDelay !== undefined)) {
        commit();
      }
      pendingAgents.push(value.toLowerCase());
      continue;
    }

    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (key === "allow" || key === "disallow") {
      // 先落实分组，再决定是否产生规则：
      // 空的 Disallow（RFC 9309）语义是"全部允许"，它不产生规则，但分组本身要能被统计和展示。
      if (!current) {
        current = { agents: pendingAgents.length ? [...pendingAgents] : ["*"], rules: [] };
        pendingAgents = [];
      }
      if (value !== "") current.rules.push({ type: key, path: value });
      continue;
    }

    if (key === "crawl-delay") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) {
        if (!current) {
          current = { agents: pendingAgents.length ? [...pendingAgents] : ["*"], rules: [] };
          pendingAgents = [];
        }
        current.crawlDelay = n;
      }
      continue;
    }
  }
  commit();

  return { groups, sitemaps, raw: text };
}

function ruleToRegex(pattern: string): { re: RegExp; matchedLen: number } {
  let p = pattern;
  let anchored = false;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return {
    re: new RegExp("^" + escaped + (anchored ? "$" : "")),
    matchedLen: p.length,
  };
}

/** 选择最匹配的 user-agent 组：精确 token 优先于 *；同 token 的多组规则合并 */
function selectGroup(parsed: ParsedRobots, botToken: string): RobotsGroup | null {
  const token = botToken.toLowerCase();
  const exact = parsed.groups.filter((g) => g.agents.some((a) => a === token));
  if (exact.length > 0) {
    return {
      agents: [token],
      rules: exact.flatMap((g) => g.rules),
      crawlDelay: exact.find((g) => g.crawlDelay !== undefined)?.crawlDelay,
    };
  }
  const wildcard = parsed.groups.filter((g) => g.agents.includes("*"));
  if (wildcard.length > 0) {
    return {
      agents: ["*"],
      rules: wildcard.flatMap((g) => g.rules),
      crawlDelay: wildcard.find((g) => g.crawlDelay !== undefined)?.crawlDelay,
    };
  }
  return null;
}

export function isAllowed(parsed: ParsedRobots, botToken: string, urlPath: string): RobotsVerdict {
  const group = selectGroup(parsed, botToken);
  if (!group || group.rules.length === 0) {
    return {
      allowed: true,
      matchedAgent: "—",
      matchedRule: null,
      reason: "robots.txt 中没有针对该爬虫的规则，默认允许抓取。",
    };
  }

  let best: RobotsRule | null = null;
  let bestLen = -1;
  for (const rule of group.rules) {
    const { re, matchedLen } = ruleToRegex(rule.path);
    if (!re.test(urlPath)) continue;
    if (matchedLen > bestLen || (matchedLen === bestLen && rule.type === "allow" && best?.type === "disallow")) {
      best = rule;
      bestLen = matchedLen;
    }
  }

  if (!best) {
    return {
      allowed: true,
      matchedAgent: group.agents.join(", "),
      matchedRule: null,
      reason: "没有任何规则命中该路径，允许抓取。",
    };
  }

  return {
    allowed: best.type === "allow",
    matchedAgent: group.agents.join(", "),
    matchedRule: best,
    reason:
      best.type === "allow"
        ? `命中 Allow: ${best.path}（由 User-agent: ${group.agents.join(", ")} 段落生效）`
        : `命中 Disallow: ${best.path}（由 User-agent: ${group.agents.join(", ")} 段落生效）`,
  };
}

/** 从已解析的 robots 里取 Sitemap 声明 */
export function declaredSitemaps(parsed: ParsedRobots): string[] {
  return parsed.sitemaps;
}
