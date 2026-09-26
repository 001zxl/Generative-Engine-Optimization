import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_STORE_FACT_KEYS,
  buildBrandSnapshot,
  buildStoreSnapshot,
  checkBrandPublishable,
  checkStorePublishable,
  decodeSlug,
  publicPath,
  selectPublicFacts,
  slugifyEntity,
  type RawFact,
} from "../src/lib/public-pages.ts";

/**
 * 公开实体页的内容组装与发布前检查。
 *
 * 两条底线要守住：
 *  1. 未核验/过期的事实不能出现在给客户看的页面上
 *  2. 缺信息时不能靠"补造"通过检查，只能拦住
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-25T00:00:00Z");

function fact(over: Partial<RawFact> & { fact_key: string }): RawFact {
  return {
    value: "值",
    status: "verified",
    source_kind: "official",
    source_url: "https://example.com/src",
    source_title: "营业执照",
    verified_at: "2026-09-01",
    valid_until: null,
    ...over,
  };
}

/* ---------------- 事实可见性 ---------------- */

test("未核验的事实不进公开页面", () => {
  const r = selectPublicFacts([fact({ fact_key: "phone", status: "draft", verified_at: null })], { now: NOW });
  assert.equal(r.visible.length, 0);
  assert.equal(r.hidden[0].reason, "尚未核验");
});

test("有争议的事实不进公开页面", () => {
  const r = selectPublicFacts([fact({ fact_key: "address", status: "disputed" })], { now: NOW });
  assert.equal(r.visible.length, 0);
  assert.equal(r.hidden[0].reason, "存在争议");
});

test("已过有效期的事实不进公开页面", () => {
  const r = selectPublicFacts([fact({ fact_key: "price_range", valid_until: "2026-01-01" })], { now: NOW });
  assert.equal(r.visible.length, 0);
  assert.match(r.hidden[0].reason, /有效期/);
});

test("核验过久的事实不进公开页面（默认 180 天）", () => {
  const old = new Date(NOW - 200 * DAY).toISOString().slice(0, 10);
  const r = selectPublicFacts([fact({ fact_key: "hours_regular", verified_at: old })], { now: NOW });
  assert.equal(r.visible.length, 0);
  assert.match(r.hidden[0].reason, /180 天/);
});

test("白名单外的键不进公开页面（内部备注不该外泄）", () => {
  assert.equal(PUBLIC_STORE_FACT_KEYS.has("status_note"), false);
  const r = selectPublicFacts([fact({ fact_key: "status_note", value: "内部：店主脾气不好" })], { now: NOW });
  assert.equal(r.visible.length, 0);
  assert.equal(r.hidden[0].reason, "非公开字段");
});

test("新鲜且已核验的事实正常公开", () => {
  const r = selectPublicFacts([fact({ fact_key: "address", value: "示例市示例区示例路" })], { now: NOW });
  assert.equal(r.visible.length, 1);
  assert.equal(r.visible[0].value, "示例市示例区示例路");
});

/* ---------------- 门店页发布检查 ---------------- */

const OK_FACTS: RawFact[] = [
  fact({ fact_key: "name", value: "示例菜馆" }),
  fact({ fact_key: "address", value: "示例市示例区示例路示例大厦对面" }),
  fact({ fact_key: "phone", value: "0000-0000000" }),
];

function storeInput(over: Partial<Parameters<typeof checkStorePublishable>[0]> = {}) {
  return {
    store: { status: "active", address: "示例市示例区示例路示例大厦对面", name: "示例菜馆" },
    visibleFacts: OK_FACTS,
    hoursText: "每日 09:00-21:30",
    blockingMapDiffs: 0,
    mapLinks: [{ platform: "amap", label: "amap", url: "https://amap.com/x" }],
    ...over,
  };
}

test("资料齐全时通过", () => {
  const r = checkStorePublishable(storeInput());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.blockers, []);
});

test("缺地址判为阻断（门店页没有地址等于没有用）", () => {
  const r = checkStorePublishable(storeInput({ store: { status: "active", address: null, name: "示例菜馆" }, visibleFacts: [] }));
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("地址")));
});

test("缺营业时间判为阻断", () => {
  const r = checkStorePublishable(storeInput({ hoursText: null }));
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("营业时间")));
});

test("已关闭/已迁址/待核实的门店不能公开", () => {
  for (const status of ["permanently_closed", "moved", "unverified"]) {
    const r = checkStorePublishable(storeInput({ store: { status, address: "x", name: "示例菜馆" } }));
    assert.equal(r.ok, false, status);
  }
});

test("暂停营业可以公开但要显著标注（警告而非阻断）", () => {
  const r = checkStorePublishable(storeInput({ store: { status: "temporarily_closed", address: "x", name: "示例菜馆" } }));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("暂停营业")));
});

test("未处理的阻断级地图差异不能公开", () => {
  const r = checkStorePublishable(storeInput({ blockingMapDiffs: 2 }));
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("阻断级地图差异")));
});

test("要展示的事实没有来源时判为阻断", () => {
  const r = checkStorePublishable(
    storeInput({ visibleFacts: [...OK_FACTS, fact({ fact_key: "price_range", source_url: null, source_title: null })] }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("price_range")), JSON.stringify(r.blockers));
});

test("缺电话/菜单/服务范围只是建议，不阻断（否则运营会绕过检查）", () => {
  const r = checkStorePublishable(storeInput({ visibleFacts: [OK_FACTS[0], OK_FACTS[1]] }));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("电话")));
  assert.ok(r.warnings.some((w) => w.includes("菜单")));
  assert.ok(r.warnings.some((w) => w.includes("服务范围")));
});

/* ---------------- 品牌页发布检查 ---------------- */

test("没有已批准事实的品牌不能公开", () => {
  const r = checkBrandPublishable({ brand: { name: "某品牌", domain: "x.com", description: "简介" }, claims: [] });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("空壳")));
});

test("声称没有证据时判为阻断", () => {
  const r = checkBrandPublishable({
    brand: { name: "某品牌", domain: "x.com", description: "简介" },
    claims: [{ key: "moq", statement: "起订 500 件", evidences: [] }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes("moq")));
});

test("证据没有可访问链接只给警告（纸质材料也算来源）", () => {
  const r = checkBrandPublishable({
    brand: { name: "某品牌", domain: "x.com", description: "简介" },
    claims: [{ key: "moq", statement: "起订 500 件", evidences: [{ title: "检测报告", url: null }] }],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.warnings.some((w) => w.includes("可访问链接")));
});

/* ---------------- 快照 ---------------- */

test("门店快照只带可见事实，且不含内部字段", () => {
  const snap = buildStoreSnapshot({
    store: { name: "示例菜馆", city: "示例市", district: "示例区", address: "示例路", category: "餐饮", service_radius_km: 3, status: "active" },
    visibleFacts: OK_FACTS,
    hoursText: "每日 09:00-21:30",
    mapLinks: [],
    updatedAt: "2026-09-25T00:00:00Z",
  });
  assert.equal(snap.kind, "store");
  assert.equal(snap.name, "示例菜馆");
  assert.equal(snap.phone, "0000-0000000");
  assert.equal(snap.statusNote, null);
  assert.deepEqual(snap.facts.map((f) => f.key).sort(), ["address", "name", "phone"]);
  // 内部字段不得出现
  assert.ok(!JSON.stringify(snap).includes("status_note"));
});

test("暂停营业的快照带出提示文本", () => {
  const snap = buildStoreSnapshot({
    store: { name: "示例菜馆", city: null, district: null, address: "x", category: null, service_radius_km: null, status: "temporarily_closed" },
    visibleFacts: OK_FACTS,
    hoursText: null,
    mapLinks: [],
    updatedAt: "2026-09-25T00:00:00Z",
  });
  assert.ok(snap.statusNote?.includes("暂停营业"));
});

test("事实值优先于门店主档字段（门户字段可能早已过时）", () => {
  const snap = buildStoreSnapshot({
    store: { name: "旧店名", city: null, district: null, address: "旧地址", category: null, service_radius_km: null, status: "active" },
    visibleFacts: OK_FACTS,
    hoursText: null,
    mapLinks: [],
    updatedAt: "2026-09-25T00:00:00Z",
  });
  assert.equal(snap.name, "示例菜馆");
  assert.equal(snap.address, "示例市示例区示例路示例大厦对面");
});

test("品牌快照逐条带出证据", () => {
  const snap = buildBrandSnapshot({
    brand: { name: "某品牌", domain: "x.com", description: "简介" },
    claims: [{ key: "moq", statement: "起订 500 件", sources: [{ title: "检测报告", url: "https://x.com/r", publisher: "SGS", evidenceLevel: "third_party" }] }],
    updatedAt: "2026-09-25T00:00:00Z",
  });
  assert.equal(snap.claims.length, 1);
  assert.equal(snap.claims[0].sources[0].publisher, "SGS");
});

/* ---------------- slug 与路径 ---------------- */

test("中文 slug 保留可读性并带区分后缀", () => {
  const slug = slugifyEntity("示例菜馆", "store_358298a5174846a093e79216");
  assert.ok(slug.startsWith("示例菜馆-"));
  assert.equal(slug.endsWith("-store_3582"), true);
});

test("同名不同实体的 slug 不冲突", () => {
  const a = slugifyEntity("示例菜馆", "store_aaaaaaaaaa");
  const b = slugifyEntity("示例菜馆", "store_bbbbbbbbbb");
  assert.notEqual(a, b);
});

test("公开路径按实体类型分开", () => {
  assert.equal(publicPath("store", "x"), "/stores/x");
  assert.equal(publicPath("brand", "y"), "/brands/y");
  // 中文 slug 需编码，否则 URL 不合法。
  // 期望值动态计算而不是写死编码串 —— 写死会在改名后悄悄失配。
  const cnSlug = "示例菜馆-abc";
  assert.equal(publicPath("store", cnSlug), `/stores/${encodeURIComponent(cnSlug)}`);
  assert.ok(publicPath("store", cnSlug).startsWith("/stores/%"), "非 ASCII slug 必须被编码");
});

test("中文 slug 的编码与解码往返（漏解码会导致中文页面全部 404）", () => {
  const slug = "示例菜馆-abc";
  const encoded = publicPath("store", slug).slice("/stores/".length);
  assert.ok(encoded.startsWith("%"), encoded);
  assert.equal(decodeSlug(encoded), slug);
});

test("decodeSlug 容忍双重编码与非法编码", () => {
  assert.equal(decodeSlug("plain-slug"), "plain-slug");
  assert.equal(decodeSlug(encodeURIComponent(encodeURIComponent("示例菜馆"))), "示例菜馆");
  // 非法百分号序列不应抛错，原样返回即可（查不到自然 404，比 500 好）
  assert.equal(decodeSlug("%E4%B8"), "%E4%B8");
  assert.equal(decodeSlug("%zz"), "%zz");
});
