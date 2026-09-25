/**
 * 第三方信源台账（纯逻辑，可单测）。
 *
 * 一条硬规则：**不得把自发文章称为独立测评**。
 *
 * 这不是措辞问题。把自家发布的稿件标成"第三方报道"，在客户那里是虚假背书，
 * 在平台那里可能构成误导性陈述。所以这里不仅区分来源性质，
 * 还会主动检查文案里有没有把自有来源描述成独立/权威第三方。
 */
export const SOURCE_KINDS = [
  {
    value: "owned",
    label: "自有内容",
    description: "我们自己或客户自己发布的内容（官网、公众号、自家博客）",
    independent: false,
  },
  {
    value: "authorized",
    label: "客户授权渠道",
    description: "客户有权发布但非自有的渠道（付费投放页、平台商家主页、授权转载）",
    independent: false,
  },
  {
    value: "independent",
    label: "独立第三方",
    description: "与客户无发布关系的第三方所写（媒体报道、行业媒体、真实用户评测）",
    independent: true,
  },
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number]["value"];

export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === "string" && SOURCE_KINDS.some((k) => k.value === v);
}

export function sourceKindLabel(kind: string | null | undefined): string {
  return SOURCE_KINDS.find((k) => k.value === kind)?.label ?? `未知来源性质（${kind ?? "未记录"}）`;
}

/** 只有独立第三方才配得上这些说法 */
export const INDEPENDENCE_CLAIMS = [
  "独立测评",
  "独立评测",
  "第三方测评",
  "第三方评测",
  "第三方报道",
  "独立报道",
  "权威认证",
  "权威背书",
  "媒体评测",
  "客观评测",
];

export interface MislabelIssue {
  phrase: string;
  message: string;
}

/**
 * 检查一段文案有没有把非独立来源说成独立/第三方。
 *
 * 只看是否出现这些说法 —— 不做语义判断。措辞规则本来就该是硬性的：
 * 只要文章里写了"独立测评"，而来源性质是自有或授权，就是错误陈述。
 */
export function detectIndependenceMislabel(text: string, kind: SourceKind): MislabelIssue[] {
  if (kind === "independent") return [];
  const issues: MislabelIssue[] = [];
  for (const phrase of INDEPENDENCE_CLAIMS) {
    if (text.includes(phrase)) {
      issues.push({
        phrase,
        message: `${sourceKindLabel(kind)}不能称为「${phrase}」—— 只有与客户无发布关系的第三方内容才可以使用这个说法`,
      });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * 可用性与新鲜度
 * ------------------------------------------------------------------ */

export interface ExternalSourceInput {
  id: string;
  claimId: string | null;
  platform: string;
  url: string;
  title: string | null;
  topic: string | null;
  kind: string;
  publishedAt: string | null;
  lastCheckedAt: string | null;
  lastStatus: string;
  lastHttpStatus: number | null;
  conflictNote?: string | null;
  note?: string | null;
}

export interface SourceIssue {
  level: "block" | "warn";
  code: string;
  message: string;
}

/** 距上次核对超过这个天数就提示重新核对 */
export const RECHECK_DAYS = 90;

export interface FreshnessOptions {
  now?: number;
  recheckDays?: number;
}

/**
 * 单条来源的问题清单。
 *
 * 阻断项：已失效、内容与事实不符、被标成独立来源但不是。
 * 建议项：长期未核对、从未核对、还没绑定事实。
 */
export function checkExternalSource(source: ExternalSourceInput, options: FreshnessOptions = {}): SourceIssue[] {
  const now = options.now ?? Date.now();
  const recheckDays = options.recheckDays ?? RECHECK_DAYS;
  const issues: SourceIssue[] = [];

  if (!isSourceKind(source.kind)) {
    issues.push({ level: "block", code: "unknown_kind", message: "未记录来源性质，无法判断它能不能作为背书" });
  }

  if (source.lastStatus === "dead") {
    issues.push({
      level: "block",
      code: "dead",
      message: `链接已失效（HTTP ${source.lastHttpStatus ?? "无响应"}）—— 引用它会指向 404，必须替换或移除`,
    });
  } else if (source.lastStatus === "mismatch") {
    issues.push({ level: "block", code: "mismatch", message: "页面内容与所支持的事实不符，不能继续作为该事实的来源" });
  } else if (source.lastStatus === "blocked") {
    issues.push({ level: "warn", code: "blocked", message: "抓取被拦截（登录墙或反爬），无法自动核对，需要人工确认" });
  } else if (source.lastStatus === "unknown" || !source.lastCheckedAt) {
    issues.push({ level: "warn", code: "never_checked", message: "从未核对过可用性" });
  }

  if (source.lastCheckedAt) {
    const at = Date.parse(source.lastCheckedAt);
    if (Number.isFinite(at) && now - at > recheckDays * 86_400_000) {
      issues.push({
        level: "warn",
        code: "stale_check",
        message: `已有 ${Math.floor((now - at) / 86_400_000)} 天未核对（阈值 ${recheckDays} 天），页面可能已改版或删除`,
      });
    }
  }

  if (source.conflictNote) {
    issues.push({ level: "block", code: "conflict", message: `与其它来源存在冲突：${source.conflictNote}` });
  }

  if (!source.claimId) {
    issues.push({ level: "warn", code: "unbound", message: "还没绑定到任何事实 —— 无法为具体陈述提供依据" });
  }

  // 标题与备注里的措辞检查
  const text = `${source.title ?? ""} ${source.note ?? ""} ${source.topic ?? ""}`;
  if (isSourceKind(source.kind)) {
    for (const issue of detectIndependenceMislabel(text, source.kind)) {
      issues.push({ level: "block", code: "mislabel", message: issue.message });
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * 按事实汇总
 * ------------------------------------------------------------------ */

export interface ClaimSourceSummary {
  claimId: string;
  claimKey: string;
  statement: string;
  total: number;
  usable: number;
  independent: number;
  hasConflict: boolean;
  /** 仍可访问的来源 */
  usableSources: Array<{ url: string; title: string | null; platform: string; kind: string; label: string }>;
  /** 不可用的来源及原因 */
  unusableSources: Array<{ url: string; title: string | null; reason: string }>;
  verdict: "supported" | "only_self" | "no_source" | "conflicting";
  note: string;
}

/**
 * 汇总一条事实有哪些**仍可访问**的来源。
 *
 * verdict 的口径：
 *  - 没有任何可用来源 → no_source
 *  - 只有自有/授权来源 → only_self（可以说"我们说明了"，不能说"第三方证实"）
 *  - 有独立第三方来源 → supported
 *  - 存在冲突 → conflicting（优先于其它结论）
 */
export function summarizeClaimSources(
  claim: { id: string; key: string; statement: string },
  sources: ExternalSourceInput[],
  options: FreshnessOptions = {},
): ClaimSourceSummary {
  const usableSources: ClaimSourceSummary["usableSources"] = [];
  const unusableSources: ClaimSourceSummary["unusableSources"] = [];
  let independent = 0;
  let hasConflict = false;

  for (const s of sources) {
    const issues = checkExternalSource(s, options);
    const blocking = issues.filter((i) => i.level === "block");
    if (blocking.some((i) => i.code === "conflict")) hasConflict = true;
    const dead = blocking.some((i) => i.code === "dead" || i.code === "mismatch");
    if (dead) {
      unusableSources.push({ url: s.url, title: s.title, reason: blocking.map((b) => b.message).join("；") });
      continue;
    }
    usableSources.push({ url: s.url, title: s.title, platform: s.platform, kind: s.kind, label: sourceKindLabel(s.kind) });
    if (s.kind === "independent" && !blocking.some((b) => b.code === "mislabel")) independent++;
  }

  let verdict: ClaimSourceSummary["verdict"];
  let note: string;
  if (hasConflict) {
    verdict = "conflicting";
    note = "来源之间存在冲突，需人工判断后才能对外使用这条陈述。";
  } else if (usableSources.length === 0) {
    verdict = "no_source";
    note = "没有任何仍可访问的来源 —— 这条陈述目前无据可查。";
  } else if (independent === 0) {
    verdict = "only_self";
    note = "只有自有或授权来源。可以说明「我们这样介绍」，但不能声称「第三方已证实」。";
  } else {
    verdict = "supported";
    note = `有 ${independent} 条独立第三方来源仍可访问。`;
  }

  return {
    claimId: claim.id,
    claimKey: claim.key,
    statement: claim.statement,
    total: sources.length,
    usable: usableSources.length,
    independent,
    hasConflict,
    usableSources,
    unusableSources,
    verdict,
    note,
  };
}

export const CLAIM_VERDICT_LABEL: Record<ClaimSourceSummary["verdict"], string> = {
  supported: "有独立来源",
  only_self: "仅自有来源",
  no_source: "无可用来源",
  conflicting: "来源冲突",
};
