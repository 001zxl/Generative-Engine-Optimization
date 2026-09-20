/** 检查器统一输出结构：结果页要"可解释"，所以每个结论都必须带证据与依据 */

export type FindingStatus = "pass" | "warn" | "fail" | "info";

export interface Finding {
  id: string;
  title: string;
  status: FindingStatus;
  /** 1 = 严重（阻断 AI 发现），2 = 需改进，3 = 建议 */
  severity: 1 | 2 | 3;
  /** 问题是什么 */
  what: string;
  /** 为什么影响 AI 发现 / 引用 */
  why: string;
  /** 检查证据（原始观测值，可复核） */
  evidence: string;
  /** 怎样修改 */
  fix?: string;
  /** 可直接复制的修复示例 */
  fixCode?: string;
}

export interface CheckSummary {
  pass: number;
  warn: number;
  fail: number;
  /** 一句话结论 */
  headline: string;
  verdict: "ok" | "needs_work" | "critical";
}

export interface CheckResult {
  tool: "crawler" | "citability";
  version: string;
  url?: string;
  checkedAt: string;
  summary: CheckSummary;
  findings: Finding[];
  /** 结构化观测数据，供结果页展开"查看样本/计算方式" */
  meta: Record<string, unknown>;
  /** 数据边界声明（§6.7：不承诺被 AI 引用） */
  disclaimer: string;
}

export function summarize(findings: Finding[], headline: string): CheckSummary {
  const pass = findings.filter((f) => f.status === "pass").length;
  const warn = findings.filter((f) => f.status === "warn").length;
  const fail = findings.filter((f) => f.status === "fail").length;
  const verdict: CheckSummary["verdict"] =
    findings.some((f) => f.status === "fail" && f.severity === 1)
      ? "critical"
      : fail > 0 || warn > 0
        ? "needs_work"
        : "ok";
  return { pass, warn, fail, headline, verdict };
}

export const DISCLAIMER =
  "本检查基于公开可抓取的页面与 robots.txt 规则做确定性判断，衡量的是「可被 AI 系统发现和引用的客观条件」。" +
  "满足条件会提高被理解和引用的可能性，但不对任何 AI 平台的实际推荐结果作出承诺。";
