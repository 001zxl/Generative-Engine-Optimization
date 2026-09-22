/**
 * 本地门店 GEO 纯逻辑单测。
 *
 * 覆盖三类会直接影响结论正确性的判断：
 *   1. 地图资料差异（错店/错位置/已打烊）
 *   2. 事实时效（没有依据的事实不能进对外内容）
 *   3. 定位方式隔离（不能把"问题文字含地点"冒充"设备真实定位"）
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeListingDiffs,
  normalizePhone,
  normalizeAddress,
  normalizeName,
  normalizeHours,
  checkFactFreshness,
  summarizeFreshness,
  assertSingleLocationMode,
  canClaimNearbyRecommendation,
  computeFactErrorRate,
  compareBaseline,
  FACT_REVERIFY_DAYS,
} from "../src/lib/local-geo.ts";

const T0 = Date.parse("2026-09-21T00:00:00Z");

/* ---------------- 归一化：写法差异不应误报为"不一致" ---------------- */

test("归一化：常见写法差异不算不一致", () => {
  // 括号样式与空格差异应归一，但分店标识要保留
  assert.equal(normalizeName("星巴克（人民广场店）"), normalizeName("星巴克(人民广场店)"), "全角/半角括号应归一");
  assert.equal(normalizeName("星巴克（人民广场店）"), normalizeName("星巴克 人民广场店"), "括号字符与空格应归一");
  assert.equal(normalizePhone("+86 138-0000-0000"), normalizePhone("13800000000"));
  assert.equal(normalizePhone("8613800000000"), normalizePhone("13800000000"), "带国家码应归一到同一号码");
  assert.equal(normalizeAddress("上海市黄浦区 南京东路 100 号"), normalizeAddress("上海市黄浦区南京东路100号"));
  assert.equal(normalizeHours("09:00～21:00"), normalizeHours("09:00-21:00"), "全角波浪号与半角连字符应归一");
});

test("店名归一不得抹掉分店标识（防「推荐错店」）", () => {
  // 这是最关键的断言：曾经用 [（(].*?[)）] 整段删除，会把两家店判成同一家
  assert.notEqual(
    normalizeName("星巴克（人民广场店）"),
    normalizeName("星巴克（南京东路店）"),
    "不同分店必须判为不一致",
  );
  const diffs = computeListingDiffs(
    { name: "星巴克（人民广场店）" },
    { seen_name: "星巴克（南京东路店）" },
  );
  assert.equal(diffs.length, 1, "分店张冠李戴必须报差异");
  assert.equal(diffs[0].severity, "block", "且必须是阻断级");
});

test("归一化不掩盖真实差异", () => {
  assert.notEqual(normalizePhone("13800000000"), normalizePhone("13900000000"));
  assert.notEqual(normalizeAddress("南京东路100号"), normalizeAddress("南京西路100号"));
});

/* ---------------- 地图资料差异 ---------------- */

test("店名/地址不一致判为阻断级", () => {
  const diffs = computeListingDiffs(
    { name: "星巴克人民广场店", address: "上海市黄浦区南京东路100号" },
    { seen_name: "星巴克南京东路店", seen_address: "上海市黄浦区南京东路100号" },
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, "name");
  assert.equal(diffs[0].severity, "block");
  assert.ok(diffs[0].reason.includes("错误门店"), "必须说明后果，不能只报不同");
});

test("电话/营业时间不一致判为警告级并给出后果", () => {
  const diffs = computeListingDiffs(
    { phone: "13800000000", hours: "09:00-21:00" },
    { seen_phone: "13900000000", seen_hours: "10:00-20:00" },
  );
  assert.equal(diffs.length, 2);
  assert.ok(diffs.every((d) => d.severity === "warn"));
  assert.ok(diffs.find((d) => d.field === "hours")!.reason.includes("打烊"));
});

test("两边写法不同但语义一致时不报差异", () => {
  const diffs = computeListingDiffs(
    { name: "星巴克（人民广场店）", phone: "+86 138-0000-0000" },
    { seen_name: "星巴克 人民广场店", seen_phone: "13800000000" },
  );
  assert.deepEqual(diffs, []);
});

test("单边缺值不算差异（缺失与填错是两回事）", () => {
  const diffs = computeListingDiffs(
    { name: "星巴克人民广场店" },
    { seen_name: null, seen_phone: "13800000000" },
  );
  assert.deepEqual(diffs, [], "平台无该字段不应混进差异列表");
});

/* ---------------- 事实时效 ---------------- */

test("未核验的事实一律不可用", () => {
  const r = checkFactFreshness({ fact_key: "hours_regular", status: "draft", verified_at: null }, T0);
  assert.equal(r.state, "unverified");
  assert.ok(r.reason.includes("不得用于对外内容"));
});

test("已过期与有争议的事实不可用", () => {
  const expired = checkFactFreshness(
    { fact_key: "menu_summary", status: "verified", verified_at: "2026-01-01", valid_until: "2026-06-01" },
    T0,
  );
  assert.equal(expired.state, "expired");

  const disputed = checkFactFreshness({ fact_key: "phone", status: "disputed", verified_at: "2026-09-01" }, T0);
  assert.equal(disputed.state, "stale");
});

test("核验过久会提示重新核验", () => {
  const old = new Date(T0 - (FACT_REVERIFY_DAYS + 10) * 86_400_000).toISOString().slice(0, 10);
  const r = checkFactFreshness({ fact_key: "hours_regular", status: "verified", verified_at: old }, T0);
  assert.equal(r.state, "stale");
  assert.ok(r.reason.includes(String(FACT_REVERIFY_DAYS)));
});

test("新鲜事实判为可用", () => {
  const recent = new Date(T0 - 10 * 86_400_000).toISOString().slice(0, 10);
  const r = checkFactFreshness({ fact_key: "hours_regular", status: "verified", verified_at: recent }, T0);
  assert.equal(r.state, "ok");
});

test("汇总时列出阻断发布的键", () => {
  const s = summarizeFreshness(
    [
      { fact_key: "name", status: "verified", verified_at: "2026-09-01" },
      { fact_key: "phone", status: "draft", verified_at: null },
      { fact_key: "menu_summary", status: "verified", verified_at: "2026-01-01", valid_until: "2026-06-01" },
      { fact_key: "address", status: "verified", verified_at: "2026-09-10" },
    ],
    T0,
  );
  assert.equal(s.ok, 2);
  assert.equal(s.unverified, 1);
  assert.equal(s.expired, 1);
  assert.deepEqual(s.blocking.sort(), ["menu_summary", "phone"]);
});

/* ---------------- 定位方式隔离 ---------------- */

test("混用定位方式必须抛错，不能静默合并", () => {
  assert.throws(
    () => assertSingleLocationMode(["device_location", "question_text_only", "device_location"]),
    /不能合并统计/,
  );
});

test("单一方式返回该方式", () => {
  assert.equal(assertSingleLocationMode(["device_location", "device_location"]), "device_location");
  assert.equal(assertSingleLocationMode([null, undefined]), "unspecified");
});

test("只有真实设备定位才可用于「附近推荐」结论", () => {
  assert.equal(canClaimNearbyRecommendation("device_location"), true);
  assert.equal(canClaimNearbyRecommendation("question_text_only"), false);
  assert.equal(canClaimNearbyRecommendation("unspecified"), false);
  assert.equal(canClaimNearbyRecommendation(null), false);
});

/* ---------------- 报告口径 ---------------- */

test("事实错误率：unknown 不进分母（否则会稀释成「看起来很好」）", () => {
  const r = computeFactErrorRate([
    { verdict: "consistent" },
    { verdict: "conflict" },
    { verdict: "unknown" },
    { verdict: "unknown" },
  ]);
  assert.ok(r);
  assert.equal(r.numerator, 1, "只有 1 条冲突");
  assert.equal(r.denominator, 2, "unknown 不计入分母");
  assert.equal(r.value, 0.5, "1/2 而不是 1/4");
});

test("事实错误率：无任何可判断陈述时返回 null（界面显示无法计算，而非 0）", () => {
  assert.equal(computeFactErrorRate([{ verdict: "unknown" }]), null);
  assert.equal(computeFactErrorRate([]), null);
});

test("基线与复测：如实报告下降，不粉饰", () => {
  const c = compareBaseline(
    "mention_rate",
    { value: 0.5, numerator: 10, denominator: 20 },
    { value: 0.3, numerator: 6, denominator: 20 },
  );
  assert.equal(c.verdict, "declined");
  assert.ok(Math.abs(c.delta! + 0.2) < 1e-9);
  assert.ok(c.note.includes("如实"));
});

test("基线与复测：持平也要明说未观察到效果", () => {
  const c = compareBaseline(
    "top1_rate",
    { value: 0.4, numerator: 8, denominator: 20 },
    { value: 0.41, numerator: 8, denominator: 20 },
  );
  assert.equal(c.verdict, "unchanged");
  assert.ok(c.note.includes("未观察到效果"));
});

test("样本量不足时不下方向判断", () => {
  const c = compareBaseline(
    "mention_rate",
    { value: 0.5, numerator: 1, denominator: 2 },
    { value: 1.0, numerator: 3, denominator: 3 },
  );
  assert.equal(c.verdict, "not_comparable");
  assert.ok(c.note.includes("样本量不足"));
});

test("缺任一侧数据都判为不可比", () => {
  assert.equal(compareBaseline("sov", null, { value: 0.5, numerator: 5, denominator: 10 }).verdict, "not_comparable");
  assert.equal(compareBaseline("sov", { value: 0.5, numerator: 5, denominator: 10 }, null).verdict, "not_comparable");
});
