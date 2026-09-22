/**
 * 本地门店 GEO 的纯逻辑（无 IO，可单测）。
 *
 * 这里放三类判断，它们都有明确的业务后果：
 *   1. 地图资料差异 —— 判断"平台上的信息"与"我们核验过的事实"是否一致
 *   2. 事实时效 —— 判断一条事实是否还有效、是否需要重新核验
 *   3. 定位方式隔离 —— 阻止把两种采样方式混在一起算指标
 */

export type LocationMode = "device_location" | "question_text_only" | "unspecified";

export const LOCATION_MODE_LABEL: Record<LocationMode, string> = {
  device_location: "真实设备定位",
  question_text_only: "仅问题文字含地点",
  unspecified: "未标注",
};

/* ==================================================================== *
 * 一、地图资料差异
 * ==================================================================== */

export type DiffField = "name" | "address" | "phone" | "hours" | "category";
export type DiffSeverity = "block" | "warn" | "info";

export interface ListingSnapshot {
  seen_name?: string | null;
  seen_address?: string | null;
  seen_phone?: string | null;
  seen_hours?: string | null;
  seen_category?: string | null;
}

export interface ExpectedFacts {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  hours?: string | null;
  category?: string | null;
}

export interface ListingDiff {
  field: DiffField;
  expected: string;
  seen: string;
  severity: DiffSeverity;
  /** 为什么这个差异重要 —— 界面上直接展示，避免"只报不同不说后果" */
  reason: string;
}

/**
 * 店名归一：只抹平**写法**差异，绝不抹掉分店标识。
 *
 * ⚠️ 这里曾经用 `/[（(].*?[)）]/g` 把括号内容整个删掉 —— 后果是
 * 「星巴克（人民广场店）」归一成「星巴克」，与「星巴克（南京东路店）」变成同一个名字，
 * 于是"分店张冠李戴"这类最严重的本地推荐错误会被判成"资料一致"而放过。
 *
 * 现在只删除括号字符本身、保留其内容：
 *   星巴克（人民广场店） / 星巴克(人民广场店) / 星巴克 人民广场店  → 同一
 *   星巴克（人民广场店） vs 星巴克（南京东路店）                  → 不同（应当报差异）
 */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]]/g, "");
}

/** 电话：只留数字；去掉中国区号前缀 86，便于 +86 / 86 / 无前缀三种写法对齐 */
export function normalizePhone(s: string | null | undefined): string {
  const digits = (s ?? "").replace(/\D/g, "");
  return digits.startsWith("86") && digits.length > 11 ? digits.slice(2) : digits;
}

/** 地址：去空白与常见标点，统一小写 —— 地址写法差异极多，只做保守归一 */
export function normalizeAddress(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[,，.。;；、\-—–_]/g, "");
}

/** 营业时间：统一分隔符与全角字符，便于"09:00-21:00"与"09:00–21:00"对齐 */
export function normalizeHours(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[～~—–－]/g, "-")
    .replace(/[：]/g, ":")
    .replace(/\s+/g, "")
    .replace(/[，,]/g, ",");
}

const FIELD_RULES: Array<{
  field: DiffField;
  severity: DiffSeverity;
  reason: string;
  norm: (s: string | null | undefined) => string;
  seenKey: keyof ListingSnapshot;
  expectedKey: keyof ExpectedFacts;
}> = [
  {
    field: "name",
    severity: "block",
    reason:
      "店名不一致会导致平台把它们当成两家店，推荐时可能指向错误门店 —— 这是本地推荐最严重的一类错误。",
    norm: normalizeName,
    seenKey: "seen_name",
    expectedKey: "name",
  },
  {
    field: "address",
    severity: "block",
    reason: "地址不一致会让用户被导航到错误位置，也让平台无法确认是同一家店。",
    norm: normalizeAddress,
    seenKey: "seen_address",
    expectedKey: "address",
  },
  {
    field: "phone",
    severity: "warn",
    reason: "电话不一致会导致漏接咨询；也常是门店换号后未同步造成的。",
    norm: normalizePhone,
    seenKey: "seen_phone",
    expectedKey: "phone",
  },
  {
    field: "hours",
    severity: "warn",
    reason: "营业时间不一致会让用户在打烊时段被引导到店 —— 是「到店扑空」的主要原因。",
    norm: normalizeHours,
    seenKey: "seen_hours",
    expectedKey: "hours",
  },
  {
    field: "category",
    severity: "info",
    reason: "类别不同会影响平台把门店归入哪个候选集合，进而影响它出现在哪些提问里。",
    norm: (s) => (s ?? "").trim().toLowerCase(),
    seenKey: "seen_category",
    expectedKey: "category",
  },
];

/**
 * 对比"我们核验过的事实"与"平台上实际看到的"。
 *
 * 只报告**两边都有值且不一致**的项：
 * 平台没这个字段（数据缺失）与「填了但填错」是两回事，
 * 混在一起会淹没真正需要处理的差异。
 */
export function computeListingDiffs(expected: ExpectedFacts, seen: ListingSnapshot): ListingDiff[] {
  const diffs: ListingDiff[] = [];
  for (const rule of FIELD_RULES) {
    const e = (expected[rule.expectedKey] ?? "").trim();
    const s = (seen[rule.seenKey] ?? "").trim();
    if (!e || !s) continue; // 缺值不判为差异，单独由"资料缺失"提醒处理
    if (rule.norm(e) === rule.norm(s)) continue;
    diffs.push({ field: rule.field, expected: e, seen: s, severity: rule.severity, reason: rule.reason });
  }
  return diffs;
}

/* ==================================================================== *
 * 二、事实时效
 * ==================================================================== */

export interface FactForFreshness {
  fact_key: string;
  status: string;
  verified_at?: string | null;
  valid_until?: string | null;
}

export interface FactFreshness {
  key: string;
  state: "ok" | "stale" | "expired" | "unverified";
  reason: string;
}

/** 默认核验有效期：半年。本地商家信息（营业时间、菜单）变化频繁。 */
export const FACT_REVERIFY_DAYS = 180;

/**
 * 判断事实是否仍然可用。
 *
 * **未核验（verified_at 为空）一律视为不可用** —— 这是「每条公开商家信息都要有依据」
 * 的落点：没有核验日期的事实不允许进入对外内容。
 */
export function checkFactFreshness(fact: FactForFreshness, now: number = Date.now()): FactFreshness {
  if (fact.status === "expired") {
    return { key: fact.fact_key, state: "expired", reason: "该事实已标记为过期" };
  }
  if (fact.status === "disputed") {
    return { key: fact.fact_key, state: "stale", reason: "该事实存在争议，需重新确认" };
  }
  if (!fact.verified_at) {
    return { key: fact.fact_key, state: "unverified", reason: "尚未核验，不得用于对外内容" };
  }
  const verified = Date.parse(fact.verified_at);
  if (!Number.isFinite(verified)) {
    return { key: fact.fact_key, state: "unverified", reason: "核验日期无法解析" };
  }
  if (fact.valid_until) {
    const until = Date.parse(fact.valid_until);
    if (Number.isFinite(until) && until < now) {
      return { key: fact.fact_key, state: "expired", reason: `有效期至 ${fact.valid_until}，已过期` };
    }
  }
  const days = (now - verified) / 86_400_000;
  if (days > FACT_REVERIFY_DAYS) {
    return {
      key: fact.fact_key,
      state: "stale",
      reason: `已核验 ${Math.floor(days)} 天，超过 ${FACT_REVERIFY_DAYS} 天建议重新核验`,
    };
  }
  return { key: fact.fact_key, state: "ok", reason: `核验于 ${fact.verified_at.slice(0, 10)}` };
}

export interface FreshnessSummary {
  ok: number;
  stale: number;
  expired: number;
  unverified: number;
  /** 未核验或过期的键 —— 发布前必须拦住 */
  blocking: string[];
}

export function summarizeFreshness(facts: FactForFreshness[], now: number = Date.now()): FreshnessSummary {
  const summary: FreshnessSummary = { ok: 0, stale: 0, expired: 0, unverified: 0, blocking: [] };
  for (const f of facts) {
    const r = checkFactFreshness(f, now);
    summary[r.state]++;
    if (r.state === "unverified" || r.state === "expired") summary.blocking.push(f.fact_key);
  }
  return summary;
}

/* ==================================================================== *
 * 三、定位方式隔离
 * ==================================================================== */

/**
 * 断言一批样本的定位方式一致。
 *
 * 为什么必须有这个函数：把"问题文字里写了地点"和"设备真实定位"混在一起算，
 * 会得到「我们在附近推荐里表现不错」的错觉。两者是完全不同的命题：
 * 前者测的是模型知不知道这个城市，后者测的才是"人在那儿时会不会被推荐"。
 *
 * 返回该批次的方式；若混用则抛出，强制调用方分组。
 */
export function assertSingleLocationMode(modes: Array<string | null | undefined>): LocationMode {
  const present = [...new Set(modes.map((m) => (m ?? "unspecified") as LocationMode))];
  if (present.length > 1) {
    throw new Error(
      `样本包含多种定位方式（${present.join(", ")}），不能合并统计。` +
        `请先按 location_mode 分组 —— 否则结论会把「AI 知道这个城市」当成「AI 在附近推荐我们」。`,
    );
  }
  return present[0] ?? "unspecified";
}

/** 只有真实设备定位的样本才允许用于「附近推荐」类结论 */
export function canClaimNearbyRecommendation(mode: LocationMode | string | null | undefined): boolean {
  return mode === "device_location";
}

/* ==================================================================== *
 * 四、报告口径
 * ==================================================================== */

export interface FactEvalRow {
  verdict: "consistent" | "conflict" | "unknown";
}

/**
 * 事实错误率 = 检出冲突的陈述数 / 已核验陈述数。
 *
 * 口径说明：unknown（无法判断）**不计入分母** —— 把它当分母会把
 * 「我们判断不了」稀释成「错误率很低」，那是自欺。
 * 分母为 0 时返回 null，由调用方显示「无法计算」而不是 0。
 */
export function computeFactErrorRate(rows: FactEvalRow[]): { value: number; numerator: number; denominator: number } | null {
  const judged = rows.filter((r) => r.verdict !== "unknown");
  if (judged.length === 0) return null;
  const conflicts = judged.filter((r) => r.verdict === "conflict").length;
  return { value: conflicts / judged.length, numerator: conflicts, denominator: judged.length };
}

/**
 * 对比基线与复测，**如实报告任何结果，包括没有提升**。
 *
 * 不做显著性包装、不说「趋势向好」这类模糊表述：
 * 只给两组数字和差值，让使用者自己判断。
 */
export interface BaselineComparison {
  metric: string;
  baseline: { value: number; numerator: number; denominator: number } | null;
  retest: { value: number; numerator: number; denominator: number } | null;
  delta: number | null;
  verdict: "improved" | "declined" | "unchanged" | "not_comparable";
  note: string;
}

export function compareBaseline(
  metric: string,
  baseline: { value: number; numerator: number; denominator: number } | null,
  retest: { value: number; numerator: number; denominator: number } | null,
): BaselineComparison {
  if (!baseline || !retest) {
    return {
      metric,
      baseline,
      retest,
      delta: null,
      verdict: "not_comparable",
      note: !baseline ? "缺少基线数据" : "缺少复测数据",
    };
  }
  // 样本量过小时不判定方向 —— 3 个样本的 33% 波动没有意义
  const MIN_N = 5;
  if (baseline.denominator < MIN_N || retest.denominator < MIN_N) {
    return {
      metric,
      baseline,
      retest,
      delta: retest.value - baseline.value,
      verdict: "not_comparable",
      note: `样本量不足（基线 ${baseline.denominator} / 复测 ${retest.denominator}，需 ≥${MIN_N}），不作方向判断`,
    };
  }
  const delta = retest.value - baseline.value;
  const verdict = delta > 0.02 ? "improved" : delta < -0.02 ? "declined" : "unchanged";
  const notes: Record<typeof verdict, string> = {
    improved: "复测高于基线。注意这只是一个批次的观察，不等于因果。",
    declined: "复测低于基线 —— 如实呈现。可能与内容改动无关（平台模型更新、时段、竞争变化）。",
    unchanged: "两次基本持平。若已发布内容，说明该动作在本条件下未观察到效果。",
  };
  return { metric, baseline, retest, delta, verdict, note: notes[verdict] };
}
