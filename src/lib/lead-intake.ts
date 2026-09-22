/**
 * 线索入口校验（纯逻辑，便于单测）。
 *
 * 抽出来的原因：这段判断决定「什么算一条真实线索」，
 * 放在路由里就只能靠人工点击验证。
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * RFC 2606 / RFC 6761 保留域名：永远不可能对应真实收件箱。
 *
 * 为什么要在入口拒绝：端到端测试会往库里写线索，试点库里因此堆过
 * 19 条 buyer@example-eu.com 的假线索，报表上看起来像「已经有 19 个客户」。
 * 把测试数据挡在入口，比事后从报表里分辨真伪可靠得多。
 */
const RESERVED_EMAIL_DOMAINS = [
  "example",
  "example.com",
  "example.net",
  "example.org",
  "test",
  "invalid",
  "localhost",
];

export function isReservedEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase().replace(/\.$/, "");
  return RESERVED_EMAIL_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
}

export type LeadEmailVerdict =
  | { ok: true }
  | { ok: false; reason: "format" | "reserved"; message: string };

/**
 * 校验线索邮箱。
 *
 * 保留域名与格式错误给**不同**的提示：前者是「你是测试数据」，
 * 后者是「你写错了」。混成一句会让真实用户不知道该怎么改。
 */
export function checkLeadEmail(email: string | null | undefined): LeadEmailVerdict {
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, reason: "format", message: "请填写有效的邮箱地址。" };
  }
  if (isReservedEmail(email)) {
    return {
      ok: false,
      reason: "reserved",
      message: "该邮箱域名是保留的示例域名（如 example.com），无法收到回复。请填写真实邮箱。",
    };
  }
  return { ok: true };
}
