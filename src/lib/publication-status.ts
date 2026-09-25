/**
 * 发布状态的四项分开呈现（纯逻辑，可单测）。
 *
 * 方案明确要求「已发布」「可抓取」「已收录」「被 AI 引用」**分开显示**。
 * 这不只是展示偏好，而是防止把推断当成事实：
 *
 *  - 已发布：我们确实记录到了成功的发布与 URL → 可以断言
 *  - 可抓取：我们自己抓过、核过 robots → 可以断言
 *  - 已收录：只有搜索引擎后台才知道 → **本站无法自行断言**
 *  - 被 AI 引用：只有采样到真实回答才知道 → 没采到就必须是"未知"，
 *    不能因为"我们发了内容"就写成"已被引用"
 *
 * 任何一步都不能由前一步推断成立 —— 这是整个产品的验收口径。
 */

export type EvidenceState = "yes" | "no" | "unknown";

export interface StatusLine {
  state: EvidenceState;
  label: string;
  /** 这条结论的依据是什么。没有依据的结论不允许出现。 */
  evidence: string;
}

export interface GateLike {
  id: string;
  label: string;
  ok: boolean;
  /** pass | fail | not_checked；缺省按 ok 推断，兼容旧数据 */
  state?: "pass" | "fail" | "not_checked";
  detail: string;
}

export interface CitationEvidence {
  /** 引用到的 URL（可能只识别出域名） */
  url: string | null;
  domain: string | null;
}

export interface PublicationStatusInput {
  url: string | null;
  publishedAt: string | null;
  channel: string | null;
  /** 最近一次发布后门槛检查 */
  gates: GateLike[];
  reachable: boolean | null;
  checkedAt: string | null;
  /** 工作区内已评测样本的引用记录 */
  citations: CitationEvidence[];
  /** 已评测样本总数（用于判断"没引用到"是否有意义） */
  evaluatedSampleCount: number;
}

export interface PublicationStatusView {
  url: string | null;
  published: StatusLine;
  crawlable: StatusLine;
  indexed: StatusLine;
  citedByAi: StatusLine;
  /** 四项里是否至少有一项是"未知"——界面据此提示不要当成已完成 */
  hasUnknown: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  own_site: "本站知识页",
  wordpress: "WordPress",
  webhook: "已配置的发布服务",
};

/** 把 URL 归一成比较用形式：去掉 hash、去掉结尾斜杠、保留查询串 */
export function normalizeForCompare(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.origin}${path}${u.search}`;
  } catch {
    return raw.trim();
  }
}

/**
 * 判断是否有引用命中该 URL。
 *
 * 允许两种命中：完整 URL 相同，或同域 + 同路径（忽略查询串差异）。
 * 只按域名命中的不算 —— 客户官网首页被引用不等于这个具体页面被引用。
 */
export function matchCitation(url: string, citations: CitationEvidence[]): CitationEvidence | undefined {
  const target = normalizeForCompare(url);
  let targetPath = "";
  try {
    targetPath = new URL(target).pathname.replace(/\/+$/, "") || "/";
  } catch {
    targetPath = "";
  }
  return citations.find((c) => {
    if (!c.url) return false;
    const got = normalizeForCompare(c.url);
    if (got === target) return true;
    try {
      const g = new URL(got);
      const t = new URL(target);
      return g.origin === t.origin && (g.pathname.replace(/\/+$/, "") || "/") === targetPath;
    } catch {
      return false;
    }
  });
}

export function buildPublicationStatus(input: PublicationStatusInput): PublicationStatusView {
  /* —— 1. 已发布：有成功的发布记录与 URL —— */
  const published: StatusLine =
    input.url && input.publishedAt
      ? {
          state: "yes",
          label: "已发布",
          evidence: `已记录发布 URL（${CHANNEL_LABEL[input.channel ?? ""] ?? input.channel ?? "未知渠道"}，${input.publishedAt.slice(0, 16).replace("T", " ")} UTC）`,
        }
      : input.url
        ? { state: "yes", label: "已发布", evidence: `已记录 URL：${input.url}` }
        : { state: "no", label: "未发布", evidence: "没有发布记录 —— 后面三项都无从谈起" };

  /* —— 2. 可抓取：来自我们自己的门槛检查 —— */
  let crawlable: StatusLine;
  const unchecked = input.gates.filter((g) => g.state === "not_checked");
  if (input.gates.length === 0) {
    // 没跑过检查就是未知 —— 不能默认成"可抓取"
    crawlable = { state: "unknown", label: "可抓取性未检查", evidence: "还没有执行发布后门槛检查" };
  } else if (input.reachable === null) {
    // 我们没查 ≠ 页面有问题。这条区分很重要，否则本地开发永远是红的
    crawlable = {
      state: "unknown",
      label: "可抓取性未检查",
      evidence: unchecked[0]?.detail ?? "门槛未执行",
    };
  } else if (input.reachable === true) {
    const passed = input.gates.filter((g) => g.ok).map((g) => g.label);
    crawlable = {
      state: "yes",
      label: "可抓取",
      evidence: `已通过：${passed.join("、")}${input.checkedAt ? `（检查于 ${input.checkedAt.slice(0, 16).replace("T", " ")} UTC）` : ""}`,
    };
  } else {
    const failed = input.gates.filter((g) => !g.ok);
    crawlable = {
      state: "no",
      label: "不可抓取",
      evidence: failed.length
        ? `未通过：${failed.map((g) => `${g.label}（${g.detail}）`).join("；")}`
        : "门槛检查未通过",
    };
  }

  /* —— 3. 已收录：本站不接入搜索引擎后台，只能如实说"未知" —— */
  const indexed: StatusLine = {
    state: "unknown",
    label: "是否已收录：未知",
    evidence:
      "本站不接入搜索引擎/地图后台，无法自行断言是否已被收录。" +
      "请到 Google Search Console、百度搜索资源平台等查询后人工回填；" +
      "「页面可抓取」不等于「已被收录」。",
  };

  /* —— 4. 被 AI 引用：只有真实采样命中才能说 yes —— */
  let citedByAi: StatusLine;
  const hit = input.url ? matchCitation(input.url, input.citations) : undefined;
  if (hit?.url) {
    citedByAi = {
      state: "yes",
      label: "已被 AI 引用",
      evidence: `在已采集的回答中观察到引用：${hit.url}`,
    };
  } else if (input.evaluatedSampleCount === 0) {
    citedByAi = {
      state: "unknown",
      label: "是否被 AI 引用：未知",
      evidence: "还没有任何采样数据 —— 不采样就不能对 AI 回答做任何判断",
    };
  } else {
    // 有样本但没命中：既不能写 yes，也不宜写 no（样本未必覆盖该页主题）
    citedByAi = {
      state: "unknown",
      label: "是否被 AI 引用：未观察到",
      evidence:
        `已评测 ${input.evaluatedSampleCount} 条样本，未观察到引用该 URL。` +
        "但样本未必覆盖本页主题，不能据此断定未被引用；请按同条件复测协议继续观察。",
    };
  }

  return {
    url: input.url,
    published,
    crawlable,
    indexed,
    citedByAi,
    hasUnknown: [published, crawlable, indexed, citedByAi].some((l) => l.state === "unknown"),
  };
}

export const STATE_STYLE: Record<EvidenceState, { label: string; className: string }> = {
  yes: { label: "是", className: "border-ok/30 bg-ok-soft text-ok" },
  no: { label: "否", className: "border-fail/30 bg-fail-soft text-fail" },
  unknown: { label: "未知", className: "border-warn/30 bg-warn-soft text-warn" },
};
