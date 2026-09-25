/**
 * JSON-LD 结构化数据生成（纯逻辑，可单测）。
 *
 * 两条规矩：
 *  1. **只描述页面上真实可见的内容**。结构化数据与可见事实必须一致 ——
 *     不一致会被判为误导性标记，风险比没有标记更大。
 *  2. **缺失或未经确认的字段一律不写**。没有评分就不写 aggregateRating，
 *     没有价格区间就不写 priceRange。编造结构化数据是最容易被抓的一种造假，
 *     而且一旦被抓，影响的是整个站点的可信度。
 *
 * 因此这里的每个生成器都接受"可能为空的输入"，并且绝不填空字符串或占位符。
 */
import type { BrandSnapshot, StoreSnapshot } from "./public-pages.ts";

export type JsonLd = Record<string, unknown>;

/** 去掉值为 undefined / null / 空字符串的键；数组为空也去掉 */
function compact<T extends JsonLd>(input: T): T {
  const out: JsonLd = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

/** 绝对 URL 由调用方提供，避免这里依赖站点配置（保持纯函数） */
export interface JsonLdContext {
  baseUrl: string;
  path: string;
}

function url(ctx: JsonLdContext): string {
  const base = ctx.baseUrl.replace(/\/+$/, "");
  const p = ctx.path.startsWith("/") ? ctx.path : `/${ctx.path}`;
  return `${base}${p}`;
}

/**
 * 餐饮门店用 Restaurant，其他门店用 LocalBusiness。
 *
 * 选择更具体的子类型是 schema.org 的推荐做法，但**不能硬套**：
 * 把一家建材店标成 Restaurant 比标成 LocalBusiness 更糟。
 */
export function localBusinessType(category: string | null | undefined): string {
  const c = (category ?? "").toLowerCase();
  const restaurantHints = ["餐饮", "餐", "炒菜", "restaurant", "food", "cafe", "咖啡", "火锅", "烧烤", "面", "饭"];
  return restaurantHints.some((h) => c.includes(h)) ? "Restaurant" : "LocalBusiness";
}

export function storeJsonLd(store: StoreSnapshot, ctx: JsonLdContext): JsonLd {
  // 只写页面上真实出现过的地址要素。
  // 这里曾经硬编码 addressCountry: "CN" —— 页面上根本没有「CN」字样，
  // 既违反"只写可见内容"的规则，也让地址为空时仍输出一个只有国家的无用 PostalAddress。
  const addr: JsonLd = compact({
    "@type": "PostalAddress",
    addressRegion: store.city ?? undefined,
    addressLocality: store.district ?? undefined,
    streetAddress: store.address ?? undefined,
  });
  const hasAddressDetail = !!(store.address || store.district || store.city);

  // 营业时间：只有文本描述，无法可靠拆成 openingHoursSpecification 时
  // 就不写该字段 —— 宁可少写，也不要写错
  return compact({
    "@context": "https://schema.org",
    "@type": localBusinessType(store.category),
    name: store.name,
    url: url(ctx),
    address: hasAddressDetail ? addr : undefined,
    telephone: store.phone ?? undefined,
    servesCuisine: store.category ?? undefined,
    description: [store.name, store.category ? `主营${store.category}` : "", store.address ?? ""]
      .filter(Boolean)
      .join("，"),
    openingHours: store.hoursText ?? undefined,
    // 人均价格是事实里核验过的值，才可写成 priceRange
    priceRange: store.priceRange ?? undefined,
    areaServed: store.serviceRadiusKm
      ? compact({ "@type": "GeoCircle", description: `约 ${store.serviceRadiusKm} 公里` })
      : undefined,
    sameAs: store.mapLinks.map((l) => l.url),
    dateModified: store.updatedAt,
  });
}

export function brandJsonLd(brand: BrandSnapshot, ctx: JsonLdContext): JsonLd {
  const domain = brand.domain?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return compact({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    url: url(ctx),
    description: brand.description ?? undefined,
    sameAs: domain ? [`https://${domain}`] : undefined,
    // 已批准的事实作为 Organization 的附加属性逐条列出，并带来源
    subjectOf: brand.claims.map((c) =>
      compact({
        "@type": "CreativeWork",
        name: c.key,
        abstract: c.statement,
        citation: c.sources.map((s) => s.url ?? undefined).filter(Boolean),
      }),
    ),
    dateModified: brand.updatedAt,
  });
}

export interface ArticleJsonLdInput {
  title: string;
  body: string;
  author: string;
  publishedAt: string;
  url: string;
  description?: string;
  /** 已绑定的证据来源，作为 citation 输出 */
  citations?: string[];
}

export function articleJsonLd(input: ArticleJsonLdInput, ctx: JsonLdContext): JsonLd {
  return compact({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description ?? undefined,
    author: compact({ "@type": "Person", name: input.author }),
    datePublished: input.publishedAt,
    dateModified: input.publishedAt,
    mainEntityOfPage: compact({ "@type": "WebPage", "@id": input.url }),
    url: url(ctx),
    citation: input.citations ?? [],
    inLanguage: "zh-CN",
  });
}

/**
 * 校验：结构化数据里的关键字段必须在页面可见文本里出现。
 *
 * 这是防"标记与页面不一致"的自检 —— schema.org 允许声明很多字段，
 * 但如果页面上看不到，就是在对外声称页面上没有的东西。
 */
export interface JsonLdConsistencyIssue {
  field: string;
  value: string;
  message: string;
}

export interface VisibleContent {
  /** 页面上可见的文字 */
  text: string;
  /** 页面上真实存在的链接地址（href / src）。
   *  URL 类字段（sameAs、citation）出现在属性里而不是文字里，
   *  只查文本会误报"页面上没有这个链接"。 */
  links?: string[];
}

export function checkJsonLdConsistency(
  data: JsonLd,
  visible: VisibleContent | string,
): JsonLdConsistencyIssue[] {
  const issues: JsonLdConsistencyIssue[] = [];
  const visibleText = typeof visible === "string" ? visible : visible.text;
  const links = new Set(typeof visible === "string" ? [] : (visible.links ?? []));
  const text = visibleText.replace(/\s+/g, " ");

  const nameFields = ["name", "headline", "description", "telephone", "priceRange", "openingHours"];
  for (const field of nameFields) {
    const value = data[field];
    if (typeof value !== "string" || !value.trim()) continue;
    // 描述类字段常由拼接生成，允许部分不匹配，只查核心标识字段
    if (field === "description") continue;
    if (!text.includes(value.trim())) {
      issues.push({ field, value, message: `结构化数据里的 ${field} 未在页面可见文本中出现` });
    }
  }

  const address = data.address as JsonLd | undefined;
  if (address && typeof address.streetAddress === "string" && address.streetAddress.trim()) {
    if (!text.includes(address.streetAddress.trim())) {
      issues.push({
        field: "address.streetAddress",
        value: address.streetAddress,
        message: "结构化数据里的地址未在页面可见文本中出现",
      });
    }
  }

  if (Array.isArray(data.sameAs)) {
    for (const link of data.sameAs) {
      if (typeof link !== "string") continue;
      // 链接既可能在可见文字里（纯文本列出），也可能在 href 属性里
      if (!text.includes(link) && !links.has(link)) {
        issues.push({ field: "sameAs", value: link, message: "sameAs 链接未在页面上出现（文本与链接都没有）" });
      }
    }
  }

  return issues;
}

/** 序列化：转义 `<` 防止提前闭合 script 标签（JSON-LD 注入的经典问题） */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
