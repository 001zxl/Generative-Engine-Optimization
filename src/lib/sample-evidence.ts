/**
 * 采样证据充分性判断（纯逻辑，可单测）。
 *
 * 方案的验收口径：**每条指标都能回到原始回答；证据不足时报告标记「不可判定」。**
 * 这个模块负责回答两个问题：
 *   1. 这条样本本身够不够格参与统计？
 *   2. 这一组样本的数量与完整性，够不够支撑一个结论？
 *
 * 一条底线写死在类型里：`fixture` / `synthetic` 证据**永远不计入外部平台结果**。
 * 用本平台自己编的回答冒充外部平台回答，是这类产品最容易发生的造假，
 * 而且一旦发生，所有指标都会变成自证。
 */

/**
 * 证据种类。只有前两种是真实外部观察。
 *
 * 注意这里**没有** "synthetic"（本平台生成的模拟回答）：
 * `sample_provenance.evidence_kind` 上有 CHECK 约束，数据库层直接拒绝写入
 * 这类值。也就是说"用自己编的回答冒充外部平台回答"这件事在存储层就不可能 ——
 * 比在应用层过滤更可靠，因为它不依赖每个写入路径都记得检查。
 */
export const EVIDENCE_KINDS = [
  { value: "manual_ui", label: "消费者界面（人工）", external: true },
  { value: "official_api", label: "官方 API", external: true },
  { value: "fixture", label: "夹具 / 演示数据", external: false },
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]["value"];

export function isExternalKind(kind: string | null | undefined): boolean {
  return EVIDENCE_KINDS.some((k) => k.value === kind && k.external);
}

export function evidenceKindLabel(kind: string | null | undefined): string {
  return EVIDENCE_KINDS.find((k) => k.value === kind)?.label ?? `未知来源（${kind ?? "未记录"}）`;
}

export interface SampleEvidenceInput {
  kind: string | null | undefined;
  rawAnswer: string | null | undefined;
  modelVersion: string | null | undefined;
  collectedAt: string | null | undefined;
  collectedBy: string | null | undefined;
  /** 平台分享链接 */
  shareUrl: string | null | undefined;
  /** 截图路径 */
  screenshotPath: string | null | undefined;
  /** 该样本记录到的引用网址 */
  citationUrls: string[];
}

export interface SampleEvidenceVerdict {
  /** 能否参与指标计算 */
  countable: boolean;
  /** 阻断项：不满足就不能计入 */
  blockers: string[];
  /** 建议项：缺失会让结论强度下降，但不阻断 */
  warnings: string[];
  /** 可追溯性：能否回到原始回答与凭据 */
  traceable: boolean;
}

/**
 * 单条样本的证据检查。
 *
 * 阻断项只有三类：来源不是外部观察、没有原文、没有采集时间与模型版本。
 * 分享链接/截图/引用/采样人员列为建议项 —— 但缺得越多，结论强度越弱，
 * 报告里会体现为「不可判定」而不是照常给数字。
 */
export function checkSampleEvidence(input: SampleEvidenceInput): SampleEvidenceVerdict {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.kind) {
    blockers.push("未记录证据来源（该回答是从哪来的）");
  } else if (!isExternalKind(input.kind)) {
    blockers.push(
      `${evidenceKindLabel(input.kind)}不是外部平台的真实回答 —— ` +
        `不得作为外部平台结果计入指标`,
    );
  }

  const answer = (input.rawAnswer ?? "").trim();
  if (!answer) blockers.push("没有保存回答原文");
  if (!(input.modelVersion ?? "").trim()) blockers.push("未记录模型版本");
  if (!(input.collectedAt ?? "").trim()) blockers.push("未记录采集时间");

  if (!(input.shareUrl ?? "").trim()) warnings.push("没有平台分享链接");
  if (!(input.screenshotPath ?? "").trim()) warnings.push("没有截图凭证");
  if ((input.citationUrls ?? []).length === 0) warnings.push("没有记录引用网址");
  if (!(input.collectedBy ?? "").trim()) warnings.push("未记录采样人员");

  const traceable =
    blockers.length === 0 && !!(input.shareUrl || input.screenshotPath);

  return { countable: blockers.length === 0, blockers, warnings, traceable };
}

/* ------------------------------------------------------------------ *
 * 分组充分性
 * ------------------------------------------------------------------ */

export interface GroupableSample {
  /** 协议 id；未绑定协议为 null */
  protocolId: string | null;
  /** manual_ui / official_api */
  surface: string;
  /** device_location / question_text_only / unspecified */
  locationMode: string;
  webSearch: boolean;
  /** 该样本是否通过单条证据检查 */
  countable: boolean;
  /** 证据是否可追溯（有链接或截图） */
  traceable: boolean;
}

export interface EvidenceGroup {
  key: string;
  protocolId: string | null;
  surface: string;
  locationMode: string;
  webSearch: boolean;
  total: number;
  countable: number;
  traceable: number;
  /** 不足判定的原因 */
  reasons: string[];
  verdict: "sufficient" | "insufficient" | "not_judgeable";
  note: string;
}

export interface EvidenceAssessment {
  groups: EvidenceGroup[];
  /** 全局结论：任一组不足 → 整体不可判定 */
  verdict: "sufficient" | "insufficient" | "not_judgeable";
  note: string;
}

/**
 * 按协议 × 界面 × 定位方式 × 联网分组，判断每组样本够不够支撑结论。
 *
 * 分组维度刻意与 B1 的可比性口径一致：不同界面（消费者界面 vs API）、
 * 不同定位方式、联网与否，都不能合并。
 */
/**
 * @param minPerGroup        每组最少可信样本数（默认 10）
 * @param minTraceableRatio  带链接或截图凭证的最低比例（默认 0.8）
 *
 * 0.8 而不是 0.5：这份报告是要交给客户的。"一半样本没有可复核凭据"
 * 支撑不起对外结论 —— 阈值定在 50% 等于允许用一半证据证明全部结论。
 */
export function assessEvidence(
  samples: GroupableSample[],
  options: { minPerGroup?: number; minTraceableRatio?: number } = {},
): EvidenceAssessment {
  const minPerGroup = options.minPerGroup ?? 10;
  const minTraceableRatio = options.minTraceableRatio ?? 0.8;

  const map = new Map<string, GroupableSample[]>();
  for (const s of samples) {
    const key = [
      s.protocolId ?? "未绑定协议",
      s.surface || "unknown",
      s.locationMode || "unspecified",
      s.webSearch ? "web" : "noweb",
    ].join(" | ");
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }

  const groups: EvidenceGroup[] = [];
  for (const [key, list] of map) {
    const first = list[0];
    const countable = list.filter((s) => s.countable).length;
    const traceable = list.filter((s) => s.traceable).length;
    const reasons: string[] = [];

    if (list.length < minPerGroup) {
      reasons.push(`有效样本 ${list.length} 条，少于 ${minPerGroup} 条`);
    }
    if (countable < list.length) {
      reasons.push(`${list.length - countable} 条因证据不足被排除`);
    }
    if (countable > 0 && traceable / countable < minTraceableRatio) {
      reasons.push(
        `仅 ${traceable}/${countable} 条带链接或截图凭证（低于 ${Math.round(minTraceableRatio * 100)}%）`,
      );
    }
    if (first.protocolId === null) {
      reasons.push("未绑定采样协议 —— 无法与其他批次对比");
    }

    let verdict: EvidenceGroup["verdict"];
    let note: string;
    if (countable === 0) {
      verdict = "not_judgeable";
      note = "没有任何可信样本，无法判定。";
    } else if (list.length < minPerGroup || countable < minPerGroup) {
      verdict = "insufficient";
      note = `样本量不足（可信 ${countable} 条），只能作为观察，不能下结论。`;
    } else if (reasons.length > 0) {
      verdict = "insufficient";
      note = `样本量达标但证据链有缺口：${reasons.join("；")}。`;
    } else {
      verdict = "sufficient";
      note = `可信样本 ${countable} 条，凭证齐全，可用于判定。`;
    }

    groups.push({
      key,
      protocolId: first.protocolId,
      surface: first.surface,
      locationMode: first.locationMode,
      webSearch: first.webSearch,
      total: list.length,
      countable,
      traceable,
      reasons,
      verdict,
      note,
    });
  }

  groups.sort((a, b) => a.key.localeCompare(b.key));

  const worst: EvidenceAssessment["verdict"] = groups.some((g) => g.verdict === "not_judgeable")
    ? "not_judgeable"
    : groups.some((g) => g.verdict === "insufficient")
      ? "insufficient"
      : groups.length === 0
        ? "not_judgeable"
        : "sufficient";

  const bad = groups.filter((g) => g.verdict !== "sufficient");
  const note =
    groups.length === 0
      ? "还没有任何样本，不可判定。"
      : worst === "sufficient"
        ? "各组证据充分，可以给出结论（仍不主张因果）。"
        : `存在证据不足的组，整体标记为${worst === "not_judgeable" ? "不可判定" : "样本量不足"}。` +
          // 只说"不足"没用，必须写出具体差在哪 —— 否则运营不知道该补样本还是补凭据
          bad
            .map((g) => `${g.key}：${g.reasons.length > 0 ? g.reasons.join("；") : g.note}`)
            .join(" | ");

  return { groups, verdict: worst, note };
}

export const EVIDENCE_VERDICT_LABEL: Record<EvidenceAssessment["verdict"], string> = {
  sufficient: "证据充分",
  insufficient: "样本量不足",
  not_judgeable: "不可判定",
};
