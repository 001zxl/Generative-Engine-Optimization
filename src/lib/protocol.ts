/**
 * 采样协议：把"在什么条件下采的"固定下来。
 *
 * 为什么需要它：同一个问题在不同条件下问出来的答案不可比 ——
 * 平台、模型版本、是否联网、地区、界面还是 API、设备定位方式，任何一项变了，
 * 前后对比就没有意义。把这些条件固化成一份**协议**，让每个采样批次明确归属，
 * 才能保证"同条件复测"不是一句口号。
 *
 * 数据不混算的落点就在 `protocol_id`：指标一律按协议分组计算，
 * 跨协议的数字只能并排展示，不能相加或求平均。
 */
export const QUESTION_CATEGORIES = [
  {
    value: "branded_awareness",
    label: "认知题（带品牌名）",
    description: "直接问品牌本身，例如「XX 是什么」「XX 靠谱吗」。用来观察模型对该实体的认知与描述是否准确。",
    /** 这类问题的答案里出现品牌是必然的，所以提及率没有意义 */
    mentionIsTrivial: true,
    countsTowardRecommendation: false,
  },
  {
    value: "unbranded_recommendation",
    label: "推荐题（不带品牌名）",
    description: "只描述需求，不提任何品牌，例如「潍坊有什么好吃的炒菜馆」。这一类才反映能否被推荐。",
    mentionIsTrivial: false,
    countsTowardRecommendation: true,
  },
  {
    value: "comparison_scenario",
    label: "对比 / 场景题",
    description: "带具体条件或要求对比，例如「三个人吃炒菜人均 60 去哪家」。用来观察模型在约束条件下的选择。",
    mentionIsTrivial: false,
    countsTowardRecommendation: true,
  },
] as const;

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number]["value"];

export const CATEGORY_VALUES = QUESTION_CATEGORIES.map((c) => c.value) as readonly QuestionCategory[];

export function getCategory(value: string | null | undefined) {
  return QUESTION_CATEGORIES.find((c) => c.value === value);
}

export function isQuestionCategory(value: unknown): value is QuestionCategory {
  return typeof value === "string" && (CATEGORY_VALUES as readonly string[]).includes(value);
}

/**
 * 只有不带品牌名的推荐题与场景题能用于判断"能否被推荐"。
 *
 * 认知题里出现品牌是必然的 —— 把它算进推荐率会把数字做得很好看，
 * 但那是自欺。
 */
export function categoriesForRecommendation(): QuestionCategory[] {
  return QUESTION_CATEGORIES.filter((c) => c.countsTowardRecommendation).map((c) => c.value);
}

/**
 * 分类检查：问题集里三类问题都应有。
 *
 * 只查认知题会得出"提及率很高"的错觉；只查推荐题会失去品牌认知的对照。
 */
export interface CategoryCoverage {
  counts: Record<QuestionCategory, number>;
  total: number;
  missing: QuestionCategory[];
  ok: boolean;
  notes: string[];
}

export function checkCategoryCoverage(categories: Array<string | null | undefined>): CategoryCoverage {
  const counts = { branded_awareness: 0, unbranded_recommendation: 0, comparison_scenario: 0 } as Record<QuestionCategory, number>;
  let uncategorized = 0;
  for (const c of categories) {
    if (isQuestionCategory(c)) counts[c]++;
    else uncategorized++;
  }
  const total = categories.length;
  const missing = CATEGORY_VALUES.filter((c) => counts[c] === 0);
  const notes: string[] = [];
  if (missing.length > 0) {
    notes.push(
      `缺少 ${missing.map((m) => getCategory(m)?.label ?? m).join("、")} —— ` +
        `推荐率只看推荐题与场景题，认知题用于核对模型对品牌的描述是否准确`,
    );
  }
  if (uncategorized > 0) {
    notes.push(`${uncategorized} 条问题还没有分类 —— 未分类的问题不参与任何分类统计`);
  }
  if (counts.branded_awareness > 0 && counts.unbranded_recommendation === 0) {
    notes.push("只有认知题：这类问题的回答里出现品牌是必然的，不能用来判断能否被推荐");
  }
  return { counts, total, missing, ok: missing.length === 0 && uncategorized === 0, notes };
}

/* ------------------------------------------------------------------ *
 * 采样条件
 * ------------------------------------------------------------------ */

/** 采样界面：消费者界面人工采样 vs 官方 API —— 两者回答可能有差异，不合并统计 */
export const SAMPLING_SURFACES = [
  { value: "manual_ui", label: "消费者界面（人工）" },
  { value: "official_api", label: "官方 API" },
] as const;

export type SamplingSurface = (typeof SAMPLING_SURFACES)[number]["value"];

export interface ProtocolConditions {
  querySetId: string;
  /** 问题集版本号：冻结时的版本。版本变了就是另一份协议 */
  querySetVersion: number;
  engines: string[];
  /** 每个问题的重复次数 */
  repetition: number;
  region: string | null;
  /** 平台是否开启联网检索 —— 开着和关着是两个不同的系统 */
  webSearch: boolean;
  surface: SamplingSurface;
  /** 定位方式：device_location / question_text_only / unspecified */
  locationMode: string;
  anchorId: string | null;
  daypart: string | null;
  /** 模型版本（平台侧声明的版本号，可空） */
  modelVersion: string | null;
}

/**
 * 协议指纹：把影响可比性的条件拼成稳定字符串。
 * 指纹相同才允许直接前后对比。
 */
export function protocolFingerprint(c: ProtocolConditions): string {
  return [
    `qs:${c.querySetId}@${c.querySetVersion}`,
    `eng:${normalizeEngines(c.engines)}`,
    `rep:${c.repetition}`,
    `region:${(c.region ?? "").trim().toUpperCase()}`,
    `web:${c.webSearch ? 1 : 0}`,
    `surf:${c.surface}`,
    `loc:${c.locationMode}`,
    `anchor:${c.anchorId ?? ""}`,
    `daypart:${c.daypart ?? ""}`,
    // 模型版本必须进指纹。
    // 它是"可以对比"的（平台会静默更新模型），但它必须被**记录下来** ——
    // 不进指纹就会导致"换模型的复测协议"被当成重复协议复用，
    // 既建不出新协议，也丢了 cloned_from 这条来源线索。
    `model:${(c.modelVersion ?? "").trim()}`,
  ].join(";");
}

/**
 * 平台名归一：去空白、转小写、**去重**后排序。
 *
 * 不去重会把 ["FixtureAI","fixtureai"] 当成另一份协议，
 * 于是同一组真实条件被拆成两份，数据随之被拆散。
 */
export function normalizeEngines(engines: string[] | null | undefined): string {
  const list = Array.isArray(engines) ? engines : [];
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort().join("|");
}

export interface ProtocolComparison {
  comparable: boolean;
  differences: Array<{ field: string; baseline: string; retest: string; severity: "block" | "warn" }>;
  /** 可比时给出的人类可读说明 */
  note: string;
}

const SURFACE_LABEL: Record<string, string> = Object.fromEntries(SAMPLING_SURFACES.map((s) => [s.value, s.label]));
const LOCATION_LABEL: Record<string, string> = {
  device_location: "真实设备定位",
  question_text_only: "仅问题文字含地点",
  unspecified: "未标注",
};

function fmt(field: string, value: unknown): string {
  if (field === "engines") {
    const list = normalizeEngines(value as string[]);
    return list ? list.split("|").join("、") : "（未指定）";
  }
  if (field === "webSearch") return value ? "开启" : "关闭";
  if (field === "surface") return SURFACE_LABEL[String(value)] ?? String(value);
  if (field === "locationMode") return LOCATION_LABEL[String(value)] ?? String(value);
  if (value === null || value === undefined || value === "") return "（未设置）";
  return String(value);
}

/**
 * 两份协议能否直接对比。
 *
 * 阻断项是"变了就不能比"的；区域与模型版本列为警告 ——
 * 模型版本由平台决定，我们无法控制，但必须记录下来。
 */
export function compareProtocols(baseline: ProtocolConditions, retest: ProtocolConditions): ProtocolComparison {
  const differences: ProtocolComparison["differences"] = [];
  const check = (field: string, a: unknown, b: unknown, severity: "block" | "warn") => {
    if (protocolFieldEqual(field, a, b)) return;
    differences.push({ field, baseline: fmt(field, a), retest: fmt(field, b), severity });
  };

  check("querySetId", baseline.querySetId, retest.querySetId, "block");
  check("querySetVersion", baseline.querySetVersion, retest.querySetVersion, "block");
  check("engines", baseline.engines, retest.engines, "block");
  check("repetition", baseline.repetition, retest.repetition, "block");
  check("webSearch", baseline.webSearch, retest.webSearch, "block");
  check("surface", baseline.surface, retest.surface, "block");
  check("locationMode", baseline.locationMode, retest.locationMode, "block");
  check("anchorId", baseline.anchorId, retest.anchorId, "block");
  check("daypart", baseline.daypart, retest.daypart, "warn");
  check("region", baseline.region, retest.region, "warn");
  check("modelVersion", baseline.modelVersion, retest.modelVersion, "warn");

  const blocked = differences.filter((d) => d.severity === "block");
  return {
    comparable: blocked.length === 0,
    differences,
    note: blocked.length === 0
      ? differences.length === 0
        ? "两份协议条件完全一致，可直接对比。"
        : "关键条件一致，可直接对比；下列非关键条件有差异，解读时需注意。"
      : `关键条件不同，不可直接对比：${blocked.map((d) => d.field).join("、")}。请用同一份协议重新采样，或只做并排展示、不做差值判断。`,
  };
}

function protocolFieldEqual(field: string, a: unknown, b: unknown): boolean {
  if (field === "engines") {
    return normalizeEngines(a as string[]) === normalizeEngines(b as string[]);
  }
  if (field === "region") {
    const norm = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");
    return norm(a) === norm(b);
  }
  const norm = (v: unknown) => (v === null || v === undefined || v === "" ? "" : v);
  return norm(a) === norm(b);
}

/**
 * 从一份已冻结的问题集复制出复测协议。
 *
 * 复制而不是复用：同一份协议每次复测都用新的一条记录，
 * 这样"这一次采样的条件"不会被后来的改动覆盖 —— 覆盖之后历史数据就不可解释了。
 */
export function cloneProtocolConditions(
  source: ProtocolConditions,
  overrides: Partial<Pick<ProtocolConditions, "region" | "modelVersion" | "daypart" | "anchorId">> = {},
): ProtocolConditions {
  return { ...source, ...overrides };
}

/** 把协议条件压成一行可读摘要，用于列表与报告 */
export function describeProtocol(c: ProtocolConditions): string {
  const parts = [
    `${c.engines.join("、") || "未指定平台"}`,
    SURFACE_LABEL[c.surface] ?? c.surface,
    c.webSearch ? "联网" : "不联网",
    LOCATION_LABEL[c.locationMode] ?? c.locationMode,
    c.region ? `地区 ${c.region.toUpperCase()}` : "地区未指定",
    `每问 ${c.repetition} 次`,
    `问题集 v${c.querySetVersion}`,
  ];
  if (c.daypart) parts.push(`时段 ${c.daypart}`);
  if (c.modelVersion) parts.push(`模型 ${c.modelVersion}`);
  return parts.join(" · ");
}
