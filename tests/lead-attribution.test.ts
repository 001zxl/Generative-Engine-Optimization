import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_LABEL,
  buildLeadAttribution,
  deriveChannel,
  displayOrUnknown,
  parseFirstTouch,
  referrerHost,
} from "../src/lib/lead-attribution.ts";

/**
 * 线索归因。
 *
 * 核心要求：**来源不明时保持「未知」**。
 * 缺字段就猜一个默认值（比如把没有 utm 的当成 direct），
 * 报表上会凭空多出一批"直接访问"，而且再也分不清真假。
 */

function input(over: Partial<Parameters<typeof buildLeadAttribution>[0]> = {}) {
  return {
    source: null,
    selfReportedSource: null,
    firstTouchJson: null,
    contentTitle: null,
    storeName: null,
    ...over,
  };
}

/* ---------------- 解析容错 ---------------- */

test("缺字段、坏 JSON、非对象都按「没有记录」处理，不抛错", () => {
  for (const raw of [null, undefined, "", "{bad json", "[]", '"str"', "123"]) {
    const t = parseFirstTouch(raw);
    assert.equal(t.landingPath, null, String(raw));
    assert.deepEqual(t.utm, {});
  }
});

test("utm 里的空值与非法值被剔除", () => {
  const t = parseFirstTouch(JSON.stringify({ utm: { a: "x", b: "", c: null, d: 5 } }));
  assert.deepEqual(t.utm, { a: "x" });
});

test("referrer 域名解析对非法 URL 返回 null（不把整条 URL 当域名）", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=x"), "www.google.com");
  assert.equal(referrerHost("not a url"), null);
  assert.equal(referrerHost(null), null);
});

/* ---------------- 渠道判定 ---------------- */

test("渠道优先级：utm_medium > source 前缀 > 引荐域名 > 未知", () => {
  assert.equal(deriveChannel({ utm: { utm_medium: "cpc" }, source: "result:tool", referrer: "https://a.com" }).channel, "cpc");
  assert.match(deriveChannel({ utm: {}, source: "result:ai-crawler-check", referrer: "https://a.com" }).channel, /站内工具结果页/);
  assert.match(deriveChannel({ utm: {}, source: null, referrer: "https://a.com/x" }).channel, /引荐（a\.com）/);
  assert.equal(deriveChannel({ utm: {}, source: null, referrer: null }).channel, UNKNOWN_LABEL);
});

test("各类 source 前缀都被识别", () => {
  for (const [src, needle] of [
    ["result:citation-readiness", "站内工具结果页"],
    ["store:haipeng", "门店页"],
    ["brand:acme", "品牌页"],
    ["knowledge:geo-basics", "知识页"],
  ] as const) {
    assert.match(deriveChannel({ utm: {}, source: src, referrer: null }).channel, new RegExp(needle), src);
  }
});

test("渠道判定说明依据，便于人工核对", () => {
  assert.equal(deriveChannel({ utm: { utm_medium: "cpc" }, source: null, referrer: null }).basis, "utm_medium");
  assert.equal(deriveChannel({ utm: {}, source: null, referrer: null }).basis, "没有任何可用信号");
});

/* ---------------- 归因组装 ---------------- */

test("信息齐全时 complete 为真且没有未知项", () => {
  const a = buildLeadAttribution(
    input({
      source: "result:ai-crawler-check",
      selfReportedSource: "朋友推荐",
      firstTouchJson: JSON.stringify({ referrer: "https://google.com", landingPath: "/r/abc", utm: { utm_medium: "organic" } }),
      contentTitle: "某篇文章",
      storeName: "海鹏菜馆",
    }),
  );
  assert.equal(a.complete, true, JSON.stringify(a.unknown));
  assert.deepEqual(a.unknown, []);
  assert.equal(a.channel, "organic");
  assert.equal(a.landingPath, "/r/abc");
  assert.equal(a.referrerHost, "google.com");
});

test("什么都没记录时逐项列为未知，而不是给默认值", () => {
  const a = buildLeadAttribution(input());
  assert.equal(a.complete, false);
  assert.equal(a.channel, UNKNOWN_LABEL);
  assert.equal(a.landingPath, null);
  assert.ok(a.unknown.includes("渠道"));
  assert.ok(a.unknown.includes("落地页"));
  assert.ok(a.unknown.includes("渠道参数（utm）"));
  assert.ok(a.unknown.includes("客户自述来源"));
  assert.ok(a.unknown.includes("关联内容"));
  assert.ok(a.unknown.includes("关联门店"));
});

test("有引荐域名但没有 utm 时，渠道已知但 utm 仍标未知", () => {
  const a = buildLeadAttribution(input({ firstTouchJson: JSON.stringify({ referrer: "https://zhihu.com/question/1" }) }));
  assert.match(a.channel, /引荐/);
  assert.ok(!a.unknown.includes("渠道"));
  assert.ok(a.unknown.includes("渠道参数（utm）"), "没有 utm 就必须标未知，不能当成 direct");
});

test("界面展示：缺失一律显示「未知」，不留空白", () => {
  assert.equal(displayOrUnknown(null), UNKNOWN_LABEL);
  assert.equal(displayOrUnknown("   "), UNKNOWN_LABEL);
  assert.equal(displayOrUnknown("有值"), "有值");
});

test("自述来源为空字符串时视为未知", () => {
  const a = buildLeadAttribution(input({ selfReportedSource: "   " }));
  assert.equal(a.selfReported, null);
  assert.ok(a.unknown.includes("客户自述来源"));
});

test("坏 first_touch_json 不会让归因崩掉，只是全部标未知", () => {
  const a = buildLeadAttribution(input({ firstTouchJson: "{broken" }));
  assert.equal(a.landingPath, null);
  assert.deepEqual(a.utm, {});
  assert.equal(a.channel, UNKNOWN_LABEL);
});
