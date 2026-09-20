/**
 * GEO 评估引擎（纯函数，无 IO，可单测）。
 *
 * 这是把「AI 的原始回答」变成「可追溯指标」的核心。设计原则：
 *
 *  1. **一切结论必须能回到原文片段。** 每条提及都带 position + snippet，
 *     指标里的分子分母都能追溯到具体样本。
 *  2. **不确定就标不确定。** 情感判定、事实一致性都是启发式，必须带 confidence；
 *     低置信度的结果进入人工复核队列，而不是直接当成事实展示。
 *  3. **不合并不可比的样本。** 不同采样方式（消费者界面 / 官方 API）、不同问题版本、
 *     不同地区的结果不能直接混算 —— 这个约束由调用方按维度分组来保证。
 */

export type Sentiment = "positive" | "neutral" | "negative";

export interface EntityRef {
  /** 规范名（用于归组统计） */
  name: string;
  /** 别名 / 错误拼写 / 曾用名，匹配时一并识别 */
  aliases: string[];
  /** 是否是我们要监测的目标品牌（否则视为竞品） */
  isTarget: boolean;
}

export interface MentionHit {
  entity: string;
  isTarget: boolean;
  /** 命中的原文（可能是别名） */
  matchedText: string;
  /** 首次出现的字符偏移 */
  position: number;
  /** 是否出现在列表项中 */
  inList: boolean;
  /** 在被跟踪实体中的列表排名（1 起）；非列表则为 null */
  listRank: number | null;
  /** 命中处的上下文片段，供人工复核 */
  snippet: string;
  sentiment: Sentiment;
  /** 情感与排名判定的置信度（0–1） */
  confidence: number;
}

export interface CitationHit {
  url: string | null;
  domain: string;
  /** 是否为自有域 */
  owned: boolean;
  position: number;
}

export interface MentionExtraction {
  mentions: MentionHit[];
  citations: CitationHit[];
  /** 回答中出现的所有 URL */
  urlCount: number;
}

/* ------------------------------------------------------------------ *
 * 匹配工具
 * ------------------------------------------------------------------ */

/** 拉丁词按词边界匹配，避免 "Acme" 命中 "Acmezilla" */
function buildMatcher(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const isAscii = /^[\x20-\x7e]+$/.test(term);
  if (isAscii) {
    // (?<![A-Za-z0-9]) ... (?![A-Za-z0-9]) —— 不用 \b，因为品牌名常含 - . 等字符
    return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi");
  }
  return new RegExp(escaped, "g");
}

const NEGATIVE_CUES = [
  "不推荐", "避免", "慎选", "风险", "投诉", "延误", "质量差", "不可靠", "问题较多",
  "不建议", "警告", "缺陷", "差评", "翻车",
  "not recommend", "avoid", "risky", "complaints", "unreliable", "poor quality", "warning",
];
const POSITIVE_CUES = [
  "推荐", "首选", "领先", "可靠", "口碑好", "优质", "值得", "优势", "擅长", "认可",
  "recommend", "leading", "reliable", "trusted", "best choice", "excellent", "strong",
];

function judgeSentiment(snippet: string): { sentiment: Sentiment; confidence: number } {
  const s = snippet.toLowerCase();
  const neg = NEGATIVE_CUES.filter((c) => s.includes(c.toLowerCase())).length;
  const pos = POSITIVE_CUES.filter((c) => s.includes(c.toLowerCase())).length;
  if (neg > 0 && neg >= pos) return { sentiment: "negative", confidence: neg > 1 ? 0.6 : 0.4 };
  if (pos > 0) return { sentiment: "positive", confidence: pos > 1 ? 0.6 : 0.4 };
  // 没有明显线索一律中性，且置信度低 —— 不假装能判断
  return { sentiment: "neutral", confidence: 0.3 };
}

/** 抽取列表结构：返回每个列表项的行号与区间 */
function parseListItems(answer: string): Array<{ rank: number; start: number; end: number; text: string }> {
  const items: Array<{ rank: number; start: number; end: number; text: string }> = [];
  const lineRe = /^[ \t]*(?:(\d{1,2})[.、)]|[-*•‧])\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  const raw: Array<{ start: number; text: string }> = [];
  while ((m = lineRe.exec(answer)) !== null) {
    raw.push({ start: m.index, text: m[2] ?? "" });
  }
  raw.forEach((r, i) => {
    const next = raw[i + 1];
    items.push({
      rank: i + 1,
      start: r.start,
      end: next ? next.start : answer.length,
      text: r.text,
    });
  });
  return items;
}

const URL_RE = /https?:\/\/[^\s<>"'）)】\]]+/g;

/**
 * 裸域名识别：**不做 TLD 白名单**。
 *
 * 早先版本枚举了 com|cn|net|org|... 之类的白名单，结果把 .se 漏掉了 ——
 * 而 nordic-profiles.se 正是目标客户（外贸工厂）最典型的域名形态，
 * 德国 .de、荷兰 .nl、越南 .vn、泰国 .th 也都会漏。
 * 现在改为「任意 2–24 位字母的顶级标签」，再用文件扩展名黑名单排除误报。
 */
const BARE_DOMAIN_RE = /(?<![A-Za-z0-9.@-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b/gi;

/** 这些后缀几乎总是文件名或缩写，不是域名 */
const NOT_A_TLD = new Set([
  "txt", "pdf", "png", "jpg", "jpeg", "gif", "svg", "webp", "md", "js", "ts", "tsx", "jsx",
  "css", "scss", "less", "html", "htm", "json", "xml", "yml", "yaml", "zip", "gz", "tar",
  "rar", "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "mp3", "mp4", "mov",
  "avi", "exe", "dmg", "apk", "log", "sql", "db", "env", "lock", "min", "map",
]);

export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    /* 保持原样 */
  }
  return host.replace(/^www\./, "").replace(/\.$/, "");
}

function isOwned(domain: string, ownedDomains: string[]): boolean {
  const d = normalizeDomain(domain);
  return ownedDomains.some((o) => {
    const od = normalizeDomain(o);
    return d === od || d.endsWith("." + od);
  });
}

/* ------------------------------------------------------------------ *
 * 主抽取函数
 * ------------------------------------------------------------------ */

export function extractFromAnswer(
  answer: string,
  entities: EntityRef[],
  ownedDomains: string[] = [],
): MentionExtraction {
  const listItems = parseListItems(answer);

  /* ---------- 提及 ---------- */
  const mentions: MentionHit[] = [];
  for (const entity of entities) {
    const terms = [entity.name, ...entity.aliases].filter((t) => t.trim().length > 0);
    let best: { pos: number; text: string } | null = null;
    for (const term of terms) {
      const re = buildMatcher(term);
      const m = re.exec(answer);
      if (m && (best === null || m.index < best.pos)) {
        best = { pos: m.index, text: m[0] };
      }
    }
    if (!best) continue;

    const item = listItems.find((it) => best!.pos >= it.start && best!.pos < it.end);
    const snippetStart = Math.max(0, best.pos - 90);
    const snippet = answer.slice(snippetStart, Math.min(answer.length, best.pos + best.text.length + 90));
    const { sentiment, confidence } = judgeSentiment(snippet);

    // 列表排名：在该列表项所属的列表里，本实体是第几个被跟踪实体
    let listRank: number | null = null;
    if (item) {
      const entitiesInList: string[] = [];
      for (const it of listItems) {
        const text = it.text.toLowerCase();
        const hitEntity = entities.find((e) =>
          [e.name, ...e.aliases].some((t) => t && text.includes(t.toLowerCase())),
        );
        if (hitEntity && !entitiesInList.includes(hitEntity.name)) entitiesInList.push(hitEntity.name);
      }
      const idx = entitiesInList.indexOf(entity.name);
      if (idx >= 0) listRank = idx + 1;
    }

    mentions.push({
      entity: entity.name,
      isTarget: entity.isTarget,
      matchedText: best.text,
      position: best.pos,
      inList: item !== undefined,
      listRank,
      snippet: snippet.trim(),
      sentiment,
      confidence,
    });
  }
  mentions.sort((a, b) => a.position - b.position);

  /* ---------- 引用 ---------- */
  const citations: CitationHit[] = [];
  const seen = new Set<string>();
  for (const m of answer.matchAll(URL_RE)) {
    const url = m[0];
    let domain = "";
    try {
      domain = normalizeDomain(new URL(url).hostname);
    } catch {
      continue;
    }
    const key = domain + "|" + url;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ url, domain, owned: isOwned(domain, ownedDomains), position: m.index ?? 0 });
  }
  for (const m of answer.matchAll(BARE_DOMAIN_RE)) {
    const domain = normalizeDomain(m[0]);
    const tld = domain.split(".").pop() ?? "";
    if (NOT_A_TLD.has(tld)) continue; // 文件名/缩写，不是域名
    // 已经被完整 URL 覆盖的域名不重复计数
    if (citations.some((c) => c.domain === domain)) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    citations.push({ url: null, domain, owned: isOwned(domain, ownedDomains), position: m.index ?? 0 });
  }
  citations.sort((a, b) => a.position - b.position);

  return { mentions, citations, urlCount: citations.filter((c) => c.url).length };
}

/* ------------------------------------------------------------------ *
 * 指标计算
 * ------------------------------------------------------------------ */

export interface SampleForMetrics {
  sampleId: string;
  mentions: MentionHit[];
  citations: CitationHit[];
}

export interface MetricValue {
  metric: "mention_rate" | "top1_rate" | "sov" | "owned_citation_rate";
  value: number;
  numerator: number;
  denominator: number;
  /** 计算口径说明，结果页直接展示 */
  basis: string;
}

export interface MetricsResult {
  metrics: MetricValue[];
  /** 分母为 0 等无法计算的情况单独列出，避免展示成 0 */
  notComputable: Array<{ metric: string; reason: string }>;
}

export function computeMetrics(samples: SampleForMetrics[]): MetricsResult {
  const metrics: MetricValue[] = [];
  const notComputable: Array<{ metric: string; reason: string }> = [];
  const total = samples.length;

  /* 提及率 = 提及目标品牌的有效样本数 / 有效样本总数 */
  if (total === 0) {
    notComputable.push({ metric: "mention_rate", reason: "没有有效样本" });
    notComputable.push({ metric: "top1_rate", reason: "没有有效样本" });
    notComputable.push({ metric: "sov", reason: "没有有效样本" });
    notComputable.push({ metric: "owned_citation_rate", reason: "没有有效样本" });
    return { metrics, notComputable };
  }
  const mentioned = samples.filter((s) => s.mentions.some((m) => m.isTarget)).length;
  metrics.push({
    metric: "mention_rate",
    value: mentioned / total,
    numerator: mentioned,
    denominator: total,
    basis: `提及目标品牌的有效样本 ${mentioned} / 有效样本总数 ${total}`,
  });

  /* 首推率 = 目标品牌位于列表第 1 位的样本数 / 可判断排名的样本数 */
  const rankable = samples.filter((s) => s.mentions.some((m) => m.isTarget && m.listRank !== null));
  if (rankable.length === 0) {
    notComputable.push({ metric: "top1_rate", reason: "没有任何样本能判断出列表排名（回答不是列表形式）" });
  } else {
    const top1 = rankable.filter((s) => {
      const t = s.mentions.find((m) => m.isTarget && m.listRank !== null);
      return t?.listRank === 1;
    }).length;
    metrics.push({
      metric: "top1_rate",
      value: top1 / rankable.length,
      numerator: top1,
      denominator: rankable.length,
      basis: `目标品牌列表排名第 1 的样本 ${top1} / 可判断排名的样本 ${rankable.length}`,
    });
  }

  /* Share of Voice = 目标品牌提及次数 / 所有被跟踪实体提及次数 */
  let targetMentions = 0;
  let allMentions = 0;
  for (const s of samples) {
    for (const m of s.mentions) {
      allMentions++;
      if (m.isTarget) targetMentions++;
    }
  }
  if (allMentions === 0) {
    notComputable.push({ metric: "sov", reason: "所有样本中都没有出现任何被跟踪实体" });
  } else {
    metrics.push({
      metric: "sov",
      value: targetMentions / allMentions,
      numerator: targetMentions,
      denominator: allMentions,
      basis: `目标品牌提及次数 ${targetMentions} / 全部被跟踪实体提及次数 ${allMentions}`,
    });
  }

  /* 自有域引用率 = 引用了自有域的样本数 / 含可识别引用的有效样本数 */
  const withCitations = samples.filter((s) => s.citations.length > 0).length;
  if (withCitations === 0) {
    notComputable.push({ metric: "owned_citation_rate", reason: "没有任何样本包含可识别的引用来源" });
  } else {
    const ownedCited = samples.filter((s) => s.citations.some((c) => c.owned)).length;
    metrics.push({
      metric: "owned_citation_rate",
      value: ownedCited / withCitations,
      numerator: ownedCited,
      denominator: withCitations,
      basis: `引用了自有域的样本 ${ownedCited} / 含可识别引用的样本 ${withCitations}`,
    });
  }

  return { metrics, notComputable };
}

/* ------------------------------------------------------------------ *
 * 事实一致性
 * ------------------------------------------------------------------ */

export interface ClaimForCheck {
  claimKey: string;
  statement: string;
  /** 要核验的关键数值（若可解析）。用于和回答中的数字比对 */
  expectedNumber?: { value: number; unit?: string };
}

export interface FactCheckResult {
  claimKey: string;
  statement: string;
  verdict: "consistent" | "conflict" | "unknown";
  /** 支持该判定的原文片段 */
  evidence: string;
  confidence: number;
}

const NUM_RE = /(\d+(?:[.,]\d+)?)\s*([%％]|倍|件|台|套|吨|公斤|千克|天|个工作日|工作日|小时|年|个月|元|美元)?/g;

function parseNumber(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 事实一致性检查（保守策略）。
 *
 * 只在**能从回答中提取到可比较数值**时才下 consistent / conflict 结论；
 * 否则一律 unknown。宁可说"无法判断"，也不要把启发式当成事实 —— 这类
 * 误判会直接损害客户对整套指标的信任。
 */
export function checkFactConsistency(answer: string, claims: ClaimForCheck[]): FactCheckResult[] {
  const found: Array<{ value: number; unit: string; index: number }> = [];
  for (const m of answer.matchAll(NUM_RE)) {
    const v = parseNumber(m[1]);
    if (v === null) continue;
    found.push({ value: v, unit: (m[2] ?? "").trim(), index: m.index ?? 0 });
  }

  return claims.map((claim) => {
    if (!claim.expectedNumber) {
      return {
        claimKey: claim.claimKey,
        statement: claim.statement,
        verdict: "unknown" as const,
        evidence: "该事实没有可自动比对的数值，需人工核验。",
        confidence: 0.2,
      };
    }
    const { value: expected, unit } = claim.expectedNumber;
    const candidates = found.filter((f) => (unit ? f.unit === unit : true));

    if (candidates.length === 0) {
      return {
        claimKey: claim.claimKey,
        statement: claim.statement,
        verdict: "unknown" as const,
        evidence: unit
          ? `回答中未出现以「${unit}」为单位的数值，无法与事实库比对。`
          : "回答中未出现可比对的数值。",
        confidence: 0.2,
      };
    }

    const hit = candidates.find((c) => c.value === expected);
    if (hit) {
      const start = Math.max(0, hit.index - 70);
      return {
        claimKey: claim.claimKey,
        statement: claim.statement,
        verdict: "consistent" as const,
        evidence: answer.slice(start, Math.min(answer.length, hit.index + 70)).trim(),
        confidence: 0.55,
      };
    }

    // 出现了同类数值但都对不上 —— 疑似冲突，但数值可能对应其它事实，
    // 所以置信度刻意压低，交人工复核。
    const c = candidates[0];
    const start = Math.max(0, c.index - 70);
    return {
      claimKey: claim.claimKey,
      statement: claim.statement,
      verdict: "conflict" as const,
      evidence:
        `事实库为 ${expected}${unit ?? ""}，回答中出现 ${c.value}${c.unit}：` +
        answer.slice(start, Math.min(answer.length, c.index + 70)).trim(),
      confidence: 0.35,
    };
  });
}
