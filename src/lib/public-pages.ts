/**
 * 公开实体页的内容组装与发布前检查（纯逻辑，可单测）。
 *
 * 一条底线：**运营台里出现过的东西不会自动变成公开页面**。
 * 公开与否由 public_pages.status 决定，且发布前必须通过这里检查。
 *
 * 第二条底线：页面上出现的每一条具体信息都必须能指向来源。
 * 「大概是这样」的信息不配上公开页面 —— 它是给客户看的，也是给 AI 抓取方看的。
 */
import type { PublicEntityType } from "./db/schema-public.ts";

export interface PublicFactView {
  key: string;
  label: string;
  value: string;
  sourceKind: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  verifiedAt: string | null;
}

export interface PublicMapLink {
  platform: string;
  label: string;
  url: string;
}

export interface StoreSnapshot {
  kind: "store";
  name: string;
  city: string | null;
  district: string | null;
  address: string | null;
  category: string | null;
  serviceRadiusKm: number | null;
  phone: string | null;
  hoursText: string | null;
  menuSummary: string | null;
  priceRange: string | null;
  parking: string | null;
  accessibility: string | null;
  /**
   * 需要向客户显著提示的经营状态（如暂停营业）。
   * 放进快照而不是页面上现查：已审核页面必须与审核时看到的一致。
   */
  statusNote: string | null;
  /** 只放经过核验、且可公开的事实 */
  facts: PublicFactView[];
  mapLinks: PublicMapLink[];
  updatedAt: string;
}

export interface PublicBrandClaim {
  key: string;
  statement: string;
  /** url 可能为空：纸质材料、店内照片等没有可访问链接，但仍是有效来源 */
  sources: Array<{ title: string; url: string | null; publisher: string | null; evidenceLevel: string }>;
}

export interface BrandSnapshot {
  kind: "brand";
  name: string;
  domain: string | null;
  description: string | null;
  /** 只放已批准且在有效期内的公开事实 */
  claims: PublicBrandClaim[];
  updatedAt: string;
}

export type PublicSnapshot = StoreSnapshot | BrandSnapshot;

/* ------------------------------------------------------------------ *
 * slug
 * ------------------------------------------------------------------ */

/** 中文与字母数字保留，其余转连字符。中文 slug 在 URL 里会被百分号编码，可读性仍好于纯哈希。 */
export function slugifyEntity(name: string, discriminator: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "page"}-${discriminator.slice(0, 10)}`;
}

/* ------------------------------------------------------------------ *
 * 事实可见性
 * ------------------------------------------------------------------ */

/** 可公开的事实键：其余键（如 status_note、内部备注）不进公开页面 */
export const PUBLIC_STORE_FACT_KEYS = new Set([
  "name",
  "address",
  "phone",
  "category",
  "hours_regular",
  "hours_holiday",
  "service_radius",
  "menu_summary",
  "price_range",
  "parking",
  "accessibility",
]);

export interface RawFact {
  fact_key: string;
  value: string;
  status: string;
  source_kind: string;
  source_url: string | null;
  source_title: string | null;
  verified_at: string | null;
  valid_until?: string | null;
}

export interface FactVisibilityOptions {
  /** 超过这个天数未核验的事实不再公开 */
  reverifyDays?: number;
  /** 当前时间，便于测试注入 */
  now?: number;
}

/**
 * 挑出可公开的事实。
 *
 * 三个条件缺一不可：是白名单键、状态已核验、且未过期。
 * 未核验=没依据，过期=可能已经变了 —— 两种都不该出现在给客户看的页面上。
 */
export function selectPublicFacts(
  facts: RawFact[],
  options: FactVisibilityOptions = {},
): { visible: RawFact[]; hidden: Array<{ fact: RawFact; reason: string }> } {
  const reverifyDays = options.reverifyDays ?? 180;
  const now = options.now ?? Date.now();
  const visible: RawFact[] = [];
  const hidden: Array<{ fact: RawFact; reason: string }> = [];

  for (const fact of facts) {
    if (!PUBLIC_STORE_FACT_KEYS.has(fact.fact_key)) {
      hidden.push({ fact, reason: "非公开字段" });
      continue;
    }
    if (fact.status !== "verified" || !fact.verified_at) {
      hidden.push({ fact, reason: fact.status === "disputed" ? "存在争议" : "尚未核验" });
      continue;
    }
    if (fact.valid_until) {
      const until = Date.parse(fact.valid_until);
      if (Number.isFinite(until) && until < now) {
        hidden.push({ fact, reason: "已过有效期" });
        continue;
      }
    }
    const verified = Date.parse(fact.verified_at);
    if (Number.isFinite(verified) && now - verified > reverifyDays * 86_400_000) {
      hidden.push({ fact, reason: `核验已超过 ${reverifyDays} 天` });
      continue;
    }
    visible.push(fact);
  }
  return { visible, hidden };
}

/* ------------------------------------------------------------------ *
 * 发布前检查
 * ------------------------------------------------------------------ */

export interface PublishCheck {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface StorePublishInput {
  store: {
    status: string;
    address: string | null;
    name: string;
  };
  visibleFacts: RawFact[];
  hoursText: string | null;
  /** 未处理的阻断级地图差异条数（店名/地址不一致） */
  blockingMapDiffs: number;
  mapLinks: PublicMapLink[];
}

/**
 * 门店页发布检查。
 *
 * 阻断项是"发出去会误导人"的，警告项是"发出去不够完整"的。
 * 两者分开：只因为缺个电话就拒绝发布，运营会绕过检查；
 * 把地址不一致当成建议，就会发出指向错误门店的页面。
 */
export function checkStorePublishable(input: StorePublishInput): PublishCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const { store, visibleFacts, hoursText, blockingMapDiffs, mapLinks } = input;

  if (store.status === "permanently_closed") blockers.push("门店状态为「已关闭」—— 公开页会引导客户白跑一趟");
  if (store.status === "moved") blockers.push("门店状态为「已迁址」—— 请先更正地址再公开");
  if (store.status === "unverified") blockers.push("门店状态仍为「待核实」—— 未核实前不应公开");
  if (store.status === "temporarily_closed") warnings.push("门店当前「暂停营业」—— 页面上必须显著标注，避免客户到店扑空");

  const has = (key: string) => visibleFacts.some((f) => f.fact_key === key);
  const valueOf = (key: string) => visibleFacts.find((f) => f.fact_key === key)?.value ?? null;

  const address = valueOf("address") ?? store.address;
  if (!address || !address.trim()) blockers.push("没有可公开的地址 —— 门店页缺地址等于没有用");

  if (!hoursText || !hoursText.trim()) blockers.push("没有可公开的营业时间 —— 客户无法判断什么时候能来");

  if (!has("name") && !store.name.trim()) blockers.push("没有可公开的店名");

  if (blockingMapDiffs > 0) {
    blockers.push(
      `存在 ${blockingMapDiffs} 条未处理的阻断级地图差异（店名/地址不一致）—— ` +
        `平台可能把你的门店当成另一家，先处理再公开`,
    );
  }

  if (!has("phone") && !valueOf("phone")) warnings.push("缺电话 —— 客户无法直接联系");
  if (!has("menu_summary") && !has("price_range")) warnings.push("缺菜单或人均价格 —— AI 回答「人均多少」这类问题时没有依据");
  if (!has("service_radius")) warnings.push("缺服务范围 —— 无法说明覆盖到哪些位置");
  if (mapLinks.length === 0) warnings.push("还没有可点击的地图资料链接 —— 建议先认领地图平台上的门店");

  // 每条要展示的事实都必须有来源，否则这一条不该出现
  for (const fact of visibleFacts) {
    if (!fact.source_url && !fact.source_title) {
      blockers.push(`事实「${fact.fact_key}」没有来源 —— 公开信息必须有依据`);
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export interface BrandPublishInput {
  brand: { name: string; domain: string | null; description: string | null };
  /** 已批准且在有效期内的事实 */
  claims: Array<{ key: string; statement: string; evidences: Array<{ title: string; url: string | null }> }>;
}

export function checkBrandPublishable(input: BrandPublishInput): PublishCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const { brand, claims } = input;

  if (!brand.name.trim()) blockers.push("品牌名为空");
  if (claims.length === 0) blockers.push("没有任何已批准的事实 —— 品牌页会变成空壳宣传页");

  // 声称必须有证据支撑；只有自述、没有可点击来源的，至少要让运营知道
  for (const claim of claims) {
    if (claim.evidences.length === 0) {
      blockers.push(`事实「${claim.key}」没有绑定任何证据 —— 不能作为公开声明`);
    } else if (!claim.evidences.some((e) => !!e.url)) {
      warnings.push(`事实「${claim.key}」的证据没有可访问链接 —— 客户无法自行核验`);
    }
  }
  if (!brand.description?.trim()) warnings.push("缺品牌简介 —— 页面缺少定位说明");
  if (!brand.domain?.trim()) warnings.push("缺官网域名 —— 建议补上以便客户核对");

  return { ok: blockers.length === 0, blockers, warnings };
}

/* ------------------------------------------------------------------ *
 * 快照组装
 * ------------------------------------------------------------------ */

export const FACT_LABEL: Record<string, string> = {
  name: "店名",
  address: "地址",
  phone: "电话",
  category: "经营类别",
  hours_regular: "常规营业时间",
  hours_holiday: "节假日营业时间",
  service_radius: "服务范围",
  menu_summary: "菜单摘要",
  price_range: "人均价格",
  parking: "停车",
  accessibility: "无障碍",
};

export const STORE_STATUS_NOTICE: Record<string, string> = {
  temporarily_closed: "该店当前暂停营业，来店前请先电话确认。",
  moved: "该店已迁址，本页信息可能尚未更新。",
};

export function buildStoreSnapshot(input: {
  store: {
    name: string;
    city: string | null;
    district: string | null;
    address: string | null;
    category: string | null;
    service_radius_km: number | null;
    status: string;
  };
  visibleFacts: RawFact[];
  hoursText: string | null;
  mapLinks: PublicMapLink[];
  updatedAt: string;
}): StoreSnapshot {
  const valueOf = (key: string) => input.visibleFacts.find((f) => f.fact_key === key)?.value ?? null;
  return {
    kind: "store",
    name: valueOf("name") ?? input.store.name,
    city: input.store.city,
    district: input.store.district,
    address: valueOf("address") ?? input.store.address,
    category: valueOf("category") ?? input.store.category,
    serviceRadiusKm: input.store.service_radius_km,
    phone: valueOf("phone"),
    hoursText: valueOf("hours_regular") ?? input.hoursText,
    menuSummary: valueOf("menu_summary"),
    priceRange: valueOf("price_range"),
    parking: valueOf("parking"),
    accessibility: valueOf("accessibility"),
    statusNote: STORE_STATUS_NOTICE[input.store.status] ?? null,
    facts: input.visibleFacts.map((f) => ({
      key: f.fact_key,
      label: FACT_LABEL[f.fact_key] ?? f.fact_key,
      value: f.value,
      sourceKind: f.source_kind,
      sourceUrl: f.source_url,
      sourceTitle: f.source_title,
      verifiedAt: f.verified_at,
    })),
    mapLinks: input.mapLinks,
    updatedAt: input.updatedAt,
  };
}

export function buildBrandSnapshot(input: {
  brand: { name: string; domain: string | null; description: string | null };
  claims: PublicBrandClaim[];
  updatedAt: string;
}): BrandSnapshot {
  return {
    kind: "brand",
    name: input.brand.name,
    domain: input.brand.domain,
    description: input.brand.description,
    claims: input.claims,
    updatedAt: input.updatedAt,
  };
}

/* ------------------------------------------------------------------ *
 * 页面路径
 * ------------------------------------------------------------------ */

/** 公开路径前缀。品牌与服务页在 /brands/，门店页在 /stores/。 */
export const PUBLIC_PATH_PREFIX: Record<PublicEntityType, string> = {
  brand: "/brands",
  store: "/stores",
};

export function publicPath(entityType: PublicEntityType, slug: string): string {
  return `${PUBLIC_PATH_PREFIX[entityType]}/${encodeURIComponent(slug)}`;
}

/**
 * 解码路由段里的 slug。
 *
 * App Router 对非 ASCII（中文）路由段给到的是百分号编码后的字符串，
 * 直接拿去查库永远查不到 —— 中文店名的公开页会全部 404。
 * 这里容忍双重编码，与知识页的处理保持一致。
 */
export function decodeSlug(slug: string): string {
  let decoded = slug;
  for (let i = 0; i < 2 && decoded.includes("%"); i++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return slug; // 非法编码：原样返回，让它查不到而不是抛错
    }
  }
  return decoded;
}
