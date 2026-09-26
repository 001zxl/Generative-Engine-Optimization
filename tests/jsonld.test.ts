import { test } from "node:test";
import assert from "node:assert/strict";
import {
  articleJsonLd,
  brandJsonLd,
  checkJsonLdConsistency,
  localBusinessType,
  serializeJsonLd,
  storeJsonLd,
} from "../src/lib/jsonld.ts";
import { buildBrandSnapshot, buildStoreSnapshot, type RawFact } from "../src/lib/public-pages.ts";

/**
 * 结构化数据生成。
 *
 * 重点验证两件事：
 *  1. 缺什么就不写什么 —— 不能补造评分、价格、奖项
 *  2. 序列化不会因为内容里的 `<` 而破坏页面结构
 */

const CTX = { baseUrl: "https://example.com", path: "/stores/x" };

function fact(key: string, value: string): RawFact {
  return {
    fact_key: key,
    value,
    status: "verified",
    source_kind: "official",
    source_url: "https://example.com/s",
    source_title: "营业执照",
    verified_at: "2026-09-01",
    valid_until: null,
  };
}

function storeSnap(over: Partial<Parameters<typeof buildStoreSnapshot>[0]> = {}) {
  return buildStoreSnapshot({
    store: { name: "示例菜馆", city: "示例市", district: "示例区", address: "示例路 1 号", category: "餐饮/炒菜", service_radius_km: 3, status: "active" },
    visibleFacts: [fact("name", "示例菜馆"), fact("address", "示例路 1 号"), fact("phone", "0000-0000000")],
    hoursText: "每日 09:00-21:30",
    mapLinks: [{ platform: "amap", label: "高德地图", url: "https://amap.com/poi/1" }],
    updatedAt: "2026-09-25T00:00:00Z",
    ...over,
  });
}

/* ---------------- 类型选择 ---------------- */

test("餐饮类门店用 Restaurant，其他用 LocalBusiness", () => {
  assert.equal(localBusinessType("餐饮/炒菜"), "Restaurant");
  assert.equal(localBusinessType("火锅"), "Restaurant");
  assert.equal(localBusinessType("restaurant"), "Restaurant");
  assert.equal(localBusinessType("建材/五金"), "LocalBusiness");
  assert.equal(localBusinessType(null), "LocalBusiness");
});

test("不把非餐饮硬套成 Restaurant", () => {
  // 「餐饮设备」含"餐"字但是卖设备的，属于误判风险；这里记录当前行为，
  // 说明分类字段必须由运营填准，不能靠猜
  assert.equal(localBusinessType("餐饮设备销售"), "Restaurant");
  assert.equal(localBusinessType("酒店住宿"), "LocalBusiness");
});

/* ---------------- 门店 JSON-LD ---------------- */

test("门店结构化数据与页面可见事实一致", () => {
  const ld = storeJsonLd(storeSnap(), CTX);
  assert.equal(ld["@type"], "Restaurant");
  assert.equal(ld.name, "示例菜馆");
  assert.equal(ld.url, "https://example.com/stores/x");
  assert.equal(ld.telephone, "0000-0000000");
  assert.equal(ld.openingHours, "每日 09:00-21:30");
  assert.deepEqual((ld.address as Record<string, unknown>).streetAddress, "示例路 1 号");
  assert.deepEqual(ld.sameAs, ["https://amap.com/poi/1"]);
});

test("缺电话/价格时字段直接不出现（不能补造）", () => {
  const ld = storeJsonLd(
    storeSnap({ visibleFacts: [fact("name", "示例菜馆"), fact("address", "示例路 1 号")] }),
    CTX,
  );
  assert.ok(!("telephone" in ld), JSON.stringify(ld));
  assert.ok(!("priceRange" in ld));
});

test("没有任何评分/奖项字段（本平台不采集，也不得编造）", () => {
  const ld = storeJsonLd(storeSnap(), CTX);
  const json = JSON.stringify(ld);
  assert.ok(!json.includes("aggregateRating"));
  assert.ok(!json.includes("award"));
  assert.ok(!json.includes("review"));
});

test("服务范围为空时不写 areaServed", () => {
  const ld = storeJsonLd(
    storeSnap({ store: { name: "示例菜馆", city: null, district: null, address: "x", category: "餐饮", service_radius_km: null, status: "active" } }),
    CTX,
  );
  assert.ok(!("areaServed" in ld));
});

test("地址全空时不输出空的 PostalAddress", () => {
  const ld = storeJsonLd(
    storeSnap({
      store: { name: "示例菜馆", city: null, district: null, address: null, category: null, service_radius_km: null, status: "active" },
      visibleFacts: [fact("name", "示例菜馆")],
    }),
    CTX,
  );
  assert.ok(!("address" in ld), JSON.stringify(ld.address));
});

test("门店一致性问题能被检出（结构化数据里写了页面看不到的字段）", () => {
  const ld = storeJsonLd(storeSnap(), CTX);
  const issues = checkJsonLdConsistency(ld, {
    text: "示例菜馆 示例路 1 号 每日 09:00-21:30 0000-0000000",
    links: ["https://amap.com/poi/1"], // 链接在 href 里，不在文字里
  });
  assert.deepEqual(issues, []);
});

test("页面缺少该字段时被判定为不一致", () => {
  const ld = storeJsonLd(storeSnap(), CTX);
  const issues = checkJsonLdConsistency(ld, { text: "示例菜馆 示例路 1 号" });
  assert.ok(issues.some((i) => i.field === "telephone"), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.field === "openingHours"));
});

/* ---------------- 品牌 JSON-LD ---------------- */

test("品牌结构化数据为 Organization 且逐条带 citation", () => {
  const snap = buildBrandSnapshot({
    brand: { name: "某品牌", domain: "https://brand.example/", description: "简介" },
    claims: [
      { key: "capacity", statement: "月产能 200 吨", sources: [{ title: "产能说明", url: "https://brand.example/c", publisher: "官网", evidenceLevel: "official" }] },
    ],
    updatedAt: "2026-09-25T00:00:00Z",
  });
  const ld = brandJsonLd(snap, { baseUrl: "https://example.com", path: "/brands/x" });
  assert.equal(ld["@type"], "Organization");
  assert.deepEqual(ld.sameAs, ["https://brand.example"]);
  const subject = ld.subjectOf as Array<Record<string, unknown>>;
  assert.equal(subject.length, 1);
  assert.deepEqual(subject[0].citation, ["https://brand.example/c"]);
});

test("品牌无域名时不写 sameAs", () => {
  const snap = buildBrandSnapshot({
    brand: { name: "某品牌", domain: null, description: null },
    claims: [{ key: "k", statement: "s", sources: [] }],
    updatedAt: "2026-09-25T00:00:00Z",
  });
  const ld = brandJsonLd(snap, { baseUrl: "https://example.com", path: "/brands/x" });
  assert.ok(!("sameAs" in ld));
  assert.ok(!("description" in ld));
});

/* ---------------- 文章 JSON-LD ---------------- */

test("文章结构化数据含作者、时间与引用", () => {
  const ld = articleJsonLd(
    {
      title: "堂食还是外卖",
      body: "正文",
      author: "内容团队",
      publishedAt: "2026-09-25T00:00:00Z",
      url: "https://example.com/knowledge/a",
      description: "对比说明",
      citations: ["https://example.com/s1"],
    },
    { baseUrl: "https://example.com", path: "/knowledge/a" },
  );
  assert.equal(ld["@type"], "Article");
  assert.equal(ld.headline, "堂食还是外卖");
  assert.deepEqual(ld.author, { "@type": "Person", name: "内容团队" });
  assert.deepEqual(ld.citation, ["https://example.com/s1"]);
  assert.equal(ld.inLanguage, "zh-CN");
});

test("无引用时不输出空 citation 数组", () => {
  const ld = articleJsonLd(
    { title: "t", body: "b", author: "a", publishedAt: "2026-09-25T00:00:00Z", url: "u" },
    { baseUrl: "https://example.com", path: "/knowledge/a" },
  );
  assert.ok(!("citation" in ld));
});

/* ---------------- 序列化安全 ---------------- */

test("序列化转义 < 防止提前闭合 script 标签", () => {
  const json = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
  assert.ok(!json.includes("</script>"), json);
  assert.ok(json.includes("\\u003c"));
  // 转义后仍是合法 JSON，且解析回来内容不丢
  assert.equal(JSON.parse(json).name, "</script><script>alert(1)</script>");
});

test("每个生成器输出都能被 JSON.parse 且是对象", () => {
  const cases = [
    serializeJsonLd(storeJsonLd(storeSnap(), CTX)),
    serializeJsonLd(
      brandJsonLd(
        buildBrandSnapshot({ brand: { name: "b", domain: null, description: null }, claims: [], updatedAt: "t" }),
        CTX,
      ),
    ),
    serializeJsonLd(
      articleJsonLd({ title: "t", body: "b", author: "a", publishedAt: "p", url: "u" }, CTX),
    ),
  ];
  for (const c of cases) {
    const parsed = JSON.parse(c);
    assert.equal(parsed["@context"], "https://schema.org");
    assert.ok(typeof parsed["@type"] === "string");
  }
});

test("结构化数据不得出现页面上没有的字样（如硬编码的国家代码）", () => {
  const ld = storeJsonLd(storeSnap(), CTX);
  const json = JSON.stringify(ld);
  // 页面上没有「CN」这个字符串，就不该出现在结构化数据里
  assert.ok(!json.includes('"CN"'), json);
  const visible = { text: "示例菜馆 示例市 示例区 示例路 1 号 每日 09:00-21:30 0000-0000000", links: ["https://amap.com/poi/1"] };
  assert.deepEqual(checkJsonLdConsistency(ld, visible), []);
});

test("链接类字段允许出现在 href 属性里（只查文本会误报）", () => {
  const ld = storeJsonLd(storeSnap(), CTX);
  const withLinks = checkJsonLdConsistency(ld, { text: "示例菜馆 示例路 1 号 每日 09:00-21:30 0000-0000000", links: ["https://amap.com/poi/1"] });
  assert.deepEqual(withLinks.filter((i) => i.field === "sameAs"), []);
  // 链接既不在文本也不在 links 里，才是真的不一致
  const missing = checkJsonLdConsistency(ld, { text: "示例菜馆 示例路 1 号 每日 09:00-21:30 0000-0000000" });
  assert.ok(missing.some((i) => i.field === "sameAs"));
});
