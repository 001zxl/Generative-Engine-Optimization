import type { FindingStatus } from "@/lib/checks/types";

/**
 * 状态到视觉的映射集中在这里：领域逻辑不散落到各页面的 className 里。
 * 配色依据呈现规范：成功绿 / 警告橙 / 严重红，且必须始终带文字标签，
 * 不允许只靠颜色传达严重程度。
 */
export interface StatusMeta {
  label: string;
  short: string;
  icon: "pass" | "warn" | "fail" | "info";
  /** 结果横幅（Verdict）用 */
  banner: string;
  /** 徽标文字色 */
  text: string;
  /** 徽标底色 */
  soft: string;
  /** 进度/条形填充 */
  fill: string;
}

export const STATUS: Record<FindingStatus, StatusMeta> = {
  pass: {
    label: "已通过",
    short: "通过",
    icon: "pass",
    banner: "border-ok/30 bg-ok-soft",
    text: "text-ok",
    soft: "bg-ok-soft border-ok/25",
    fill: "bg-ok",
  },
  warn: {
    label: "需要改进",
    short: "待改",
    icon: "warn",
    banner: "border-warn/30 bg-warn-soft",
    text: "text-warn",
    soft: "bg-warn-soft border-warn/25",
    fill: "bg-warn",
  },
  fail: {
    label: "严重问题",
    short: "严重",
    icon: "fail",
    banner: "border-fail/30 bg-fail-soft",
    text: "text-fail",
    soft: "bg-fail-soft border-fail/25",
    fill: "bg-fail",
  },
  info: {
    label: "背景信息",
    short: "背景",
    icon: "info",
    banner: "border-border bg-info-soft",
    text: "text-muted-foreground",
    soft: "bg-info-soft border-border",
    fill: "bg-muted-foreground",
  },
};

export const VERDICT_BANNER: Record<string, string> = {
  ok: "border-ok/30 bg-ok-soft",
  needs_work: "border-warn/30 bg-warn-soft",
  critical: "border-fail/30 bg-fail-soft",
};

export const VERDICT_LABEL: Record<string, string> = {
  ok: "通过",
  needs_work: "需要改进",
  critical: "存在严重问题",
};

export function scoreTone(score: number): FindingStatus {
  if (score >= 70) return "pass";
  if (score >= 40) return "warn";
  return "fail";
}
