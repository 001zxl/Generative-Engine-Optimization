/**
 * 线索通知。
 *
 * 为什么需要它：在加这个之前，线索只是**入库**——不提醒任何人。
 * 对"投放→线索"的生意来说，入库而没有提醒等于线索会被漏掉：
 * 你只会在下次主动打开运营台时才发现有人留了联系方式。
 *
 * 设计取舍：
 *  - **用 Webhook 而不是 SMTP**：钉钉/企业微信/飞书机器人都支持入站 Webhook，
 *    配置成本一次复制粘贴，且不引入邮件依赖（Node 无内置 SMTP 客户端）。
 *    按 URL 自动识别格式，也兼容 Slack 与自定义端点。
 *  - **通知失败绝不影响线索保存**：先入库、再通知；通知抛错只记录，不向上抛。
 *  - **失败必须可见**：失败原因写回 leads.notify_error，运营台能看到，
 *    而不是只躺在日志里。
 *  - **未配置时明确告警**：不是静默什么都不做。
 */

export type NotifyChannel = "dingtalk" | "wecom" | "feishu" | "slack" | "generic";

export interface LeadNotification {
  leadId: string;
  email: string | null;
  company?: string | null;
  website?: string | null;
  message?: string | null;
  source?: string | null;
  selfReportedSource?: string | null;
  createdAt: string;
  consoleUrl?: string;
}

export interface NotifyResult {
  ok: boolean;
  channel?: NotifyChannel;
  skipped?: "not_configured";
  error?: string;
}

export function detectChannel(url: string): NotifyChannel {
  const u = url.toLowerCase();
  if (u.includes("oapi.dingtalk.com")) return "dingtalk";
  if (u.includes("qyapi.weixin.qq.com")) return "wecom";
  if (u.includes("open.feishu.cn") || u.includes("open.larksuite.com")) return "feishu";
  if (u.includes("hooks.slack.com")) return "slack";
  return "generic";
}

function plainText(n: LeadNotification): string {
  const lines = [
    "【新线索】GEO 可见度实验室",
    `邮箱：${n.email ?? "（未填）"}`,
    n.company ? `公司：${n.company}` : null,
    n.website ? `网站：${n.website}` : null,
    n.source ? `来源：${n.source}` : null,
    n.selfReportedSource ? `自述来源：${n.selfReportedSource}` : null,
    n.message ? `留言：${n.message.slice(0, 300)}` : null,
    `时间：${n.createdAt.slice(0, 16).replace("T", " ")}`,
    "",
    "⚠️ 请在 24 小时内跟进。未跟进的线索等于没有线索。",
  ];
  return lines.filter(Boolean).join("\n");
}

/** 按渠道构造请求体 —— 各家的 JSON 结构不兼容，必须分别处理 */
export function buildPayload(channel: NotifyChannel, n: LeadNotification): unknown {
  const text = plainText(n);
  switch (channel) {
    case "dingtalk":
      return { msgtype: "text", text: { content: text } };
    case "wecom":
      return { msgtype: "text", text: { content: text } };
    case "feishu":
      return { msg_type: "text", content: { text } };
    case "slack":
      return { text };
    default:
      return {
        type: "lead",
        leadId: n.leadId,
        email: n.email,
        company: n.company ?? null,
        website: n.website ?? null,
        message: n.message ?? null,
        source: n.source ?? null,
        selfReportedSource: n.selfReportedSource ?? null,
        createdAt: n.createdAt,
        consoleUrl: n.consoleUrl ?? null,
      };
  }
}

const TIMEOUT_MS = 8000;

export function isNotifyConfigured(): boolean {
  return Boolean(process.env.LEAD_NOTIFY_WEBHOOK?.trim());
}

/**
 * 发送通知。**不抛异常** —— 调用方拿到 ok/error 自行决定如何记录。
 */
export async function notifyLead(n: LeadNotification): Promise<NotifyResult> {
  const url = process.env.LEAD_NOTIFY_WEBHOOK?.trim();
  if (!url) {
    console.warn(
      "[notify] ⚠️ 未配置 LEAD_NOTIFY_WEBHOOK，新线索只会入库、不会提醒任何人。" +
        "正式获客前请配置（钉钉/企微/飞书 机器人的入站 Webhook 均可）。",
    );
    return { ok: false, skipped: "not_configured" };
  }

  const channel = detectChannel(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(channel, n)),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, channel, error: `HTTP ${res.status} ${res.statusText}`.trim() };
    }
    // 钉钉/企微 即使 HTTP 200 也可能在 body 里报错
    const body = await res.text().catch(() => "");
    if (/"errcode"\s*:\s*[1-9]/.test(body) || /"code"\s*:\s*[1-9]/.test(body)) {
      return { ok: false, channel, error: `服务端返回错误：${body.slice(0, 200)}` };
    }
    return { ok: true, channel };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "通知超时（8 秒）"
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, channel, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
