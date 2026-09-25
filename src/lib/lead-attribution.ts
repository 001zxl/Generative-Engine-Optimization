/**
 * 线索归因信息组装（纯逻辑，可单测）。
 *
 * 方案要求：线索附带落地页 / 内容 / 渠道参数与客户自述来源；
 * **线索来源不明时保持「未知」**。
 *
 * 最后一句是关键。归因最容易犯的错是"缺字段就按默认值算" ——
 * 把没有 utm 的线索默默记成 direct，报表上就会凭空多出一批"直接访问"，
 * 而且没人能区分"真是直接访问"和"我们没采到"。所以这里的原则是：
 * 缺什么就写"未知"，绝不猜一个看起来合理的值。
 */

export interface FirstTouch {
  referrer?: string | null;
  landingPath?: string | null;
  utm?: Record<string, string> | null;
}

export interface LeadAttributionInput {
  source: string | null;
  selfReportedSource: string | null;
  firstTouchJson: string | null;
  /** 关联的内容资产标题（若能关联到）；没有就是 null */
  contentTitle?: string | null;
  /** 关联门店名（本地门店线索） */
  storeName?: string | null;
}

export interface LeadAttribution {
  /** 渠道：utm_medium > 来源前缀 > 引荐域名 > 未知 */
  channel: string;
  /** 渠道是怎么来的，供人工核对 */
  channelBasis: string;
  landingPath: string | null;
  utm: Record<string, string>;
  referrerHost: string | null;
  contentTitle: string | null;
  storeName: string | null;
  selfReported: string | null;
  /** 缺失的项，逐条列出 —— 界面上显示为「未知」而不是空白 */
  unknown: string[];
  /** 是否所有归因线索都齐全 */
  complete: boolean;
}

/**
 * 容错解析 first_touch_json：坏 JSON 按"没有记录"处理，不抛错也不猜。
 *
 * 空情况显式返回 null 而不是 undefined —— undefined 会在 JSON 序列化时
 * 整个键消失，前端拿到的是"字段不存在"，与"字段存在但为空"是两种状态，
 * 排查归因问题时会被这两种状态绕进去。
 */
export function parseFirstTouch(raw: string | null | undefined): FirstTouch {
  const empty: FirstTouch = { referrer: null, landingPath: null, utm: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const obj = parsed as Record<string, unknown>;
    const utmRaw = obj.utm;
    const utm: Record<string, string> = {};
    if (utmRaw && typeof utmRaw === "object" && !Array.isArray(utmRaw)) {
      for (const [k, v] of Object.entries(utmRaw as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) utm[k] = v.trim();
      }
    }
    return {
      referrer: typeof obj.referrer === "string" && obj.referrer.trim() ? obj.referrer.trim() : null,
      landingPath: typeof obj.landingPath === "string" && obj.landingPath.trim() ? obj.landingPath.trim() : null,
      utm,
    };
  } catch {
    return empty;
  }
}

/** 从 referrer 里取域名；非法 URL 返回 null（不返回原串，避免把整条 URL 当域名显示） */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const UNKNOWN = "未知";

/**
 * 判定渠道优先级：
 *   1. utm_medium（投放参数，最明确）
 *   2. source 的 "result:工具名" 前缀（站内自有入口）
 *   3. 引荐域名（自然/外链）
 *   4. 未知
 */
export function deriveChannel(input: { utm: Record<string, string>; source: string | null; referrer: string | null }): { channel: string; basis: string } {
  const medium = input.utm.utm_medium?.trim();
  if (medium) return { channel: medium, basis: "utm_medium" };
  const source = (input.source ?? "").trim();
  if (source.startsWith("result:")) {
    return { channel: `站内工具结果页（${source.slice("result:".length)}）`, basis: "source 前缀" };
  }
  if (source.startsWith("store:")) return { channel: `门店页（${source.slice("store:".length)}）`, basis: "source 前缀" };
  if (source.startsWith("brand:")) return { channel: `品牌页（${source.slice("brand:".length)}）`, basis: "source 前缀" };
  if (source.startsWith("knowledge:")) return { channel: `知识页（${source.slice("knowledge:".length)}）`, basis: "source 前缀" };
  const host = referrerHost(input.referrer);
  if (host) return { channel: `引荐（${host}）`, basis: "referrer 域名" };
  return { channel: UNKNOWN, basis: "没有任何可用信号" };
}

export function buildLeadAttribution(input: LeadAttributionInput): LeadAttribution {
  const touch = parseFirstTouch(input.firstTouchJson);
  const utm = touch.utm ?? {};
  const { channel, basis } = deriveChannel({ utm, source: input.source, referrer: touch.referrer ?? null });
  const host = referrerHost(touch.referrer);

  const unknown: string[] = [];
  if (channel === UNKNOWN) unknown.push("渠道");
  if (!touch.landingPath) unknown.push("落地页");
  if (Object.keys(utm).length === 0) unknown.push("渠道参数（utm）");
  if (!input.selfReportedSource?.trim()) unknown.push("客户自述来源");
  if (!input.contentTitle) unknown.push("关联内容");
  if (!input.storeName) unknown.push("关联门店");

  return {
    channel,
    channelBasis: basis,
    landingPath: touch.landingPath ?? null,
    utm,
    referrerHost: host,
    contentTitle: input.contentTitle ?? null,
    storeName: input.storeName ?? null,
    selfReported: input.selfReportedSource?.trim() || null,
    unknown,
    complete: unknown.length === 0,
  };
}

/** 界面上每一项的展示值：缺失时统一显示「未知」，不留空白 */
export function displayOrUnknown(value: string | null | undefined): string {
  return value && value.trim() ? value : UNKNOWN;
}

export const UNKNOWN_LABEL = UNKNOWN;
