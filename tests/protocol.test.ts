import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_VALUES,
  QUESTION_CATEGORIES,
  categoriesForRecommendation,
  checkCategoryCoverage,
  cloneProtocolConditions,
  compareProtocols,
  describeProtocol,
  protocolFingerprint,
  type ProtocolConditions,
} from "../src/lib/protocol.ts";

/**
 * 采样协议与问题分类。
 *
 * 两条底线：
 *  1. 只有推荐题与场景题参与"能否被推荐"的判断 —— 认知题里出现品牌是必然的
 *  2. 条件变了就不能直接对比 —— 跨协议的数字只能并排看，不能相减
 */

function conditions(over: Partial<ProtocolConditions> = {}): ProtocolConditions {
  return {
    querySetId: "qs_1",
    querySetVersion: 1,
    engines: ["ChatGPT"],
    repetition: 3,
    region: "CN",
    webSearch: true,
    surface: "manual_ui",
    locationMode: "device_location",
    anchorId: "anchor_1",
    daypart: "dinner",
    modelVersion: "gpt-5",
    ...over,
  };
}

/* ---------------- 三类问题 ---------------- */

test("固定三类问题，且只有推荐题与场景题计入推荐判断", () => {
  assert.deepEqual(CATEGORY_VALUES, ["branded_awareness", "unbranded_recommendation", "comparison_scenario"]);
  assert.deepEqual(categoriesForRecommendation(), ["unbranded_recommendation", "comparison_scenario"]);
  const branded = QUESTION_CATEGORIES.find((c) => c.value === "branded_awareness")!;
  assert.equal(branded.countsTowardRecommendation, false);
  assert.equal(branded.mentionIsTrivial, true, "认知题里出现品牌是必然的，提及率没有意义");
});

test("每类问题都有说明，避免运营填错", () => {
  for (const c of QUESTION_CATEGORIES) {
    assert.ok(c.label.length > 0 && c.description.length > 10, c.value);
  }
});

test("分类覆盖：三类齐全才算 ok", () => {
  const r = checkCategoryCoverage(["branded_awareness", "unbranded_recommendation", "comparison_scenario"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { branded_awareness: 1, unbranded_recommendation: 1, comparison_scenario: 1 });
});

test("分类覆盖：缺类时指明缺哪一类并说明影响", () => {
  const r = checkCategoryCoverage(["branded_awareness", "branded_awareness"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["unbranded_recommendation", "comparison_scenario"]);
  assert.ok(r.notes.some((n) => n.includes("推荐题")));
});

test("分类覆盖：只有认知题时给出专门警告", () => {
  const r = checkCategoryCoverage(["branded_awareness"]);
  assert.ok(r.notes.some((n) => n.includes("出现品牌是必然的")), JSON.stringify(r.notes));
});

test("分类覆盖：未分类的问题被单独统计", () => {
  const r = checkCategoryCoverage(["branded_awareness", null, undefined, "unbranded_recommendation", "comparison_scenario"]);
  assert.equal(r.ok, false);
  assert.ok(r.notes.some((n) => n.includes("2 条问题还没有分类")));
});

/* ---------------- 协议指纹 ---------------- */

test("指纹相同当且仅当影响可比性的条件相同", () => {
  const a = protocolFingerprint(conditions());
  assert.equal(a, protocolFingerprint(conditions()));
  // 平台顺序不影响指纹
  assert.equal(protocolFingerprint(conditions({ engines: ["A", "B"] })), protocolFingerprint(conditions({ engines: ["b", "a"] })));
  // 地区大小写不影响
  assert.equal(protocolFingerprint(conditions({ region: "cn" })), protocolFingerprint(conditions({ region: "CN" })));
});

test("指纹对每一项关键条件都敏感", () => {
  const base = protocolFingerprint(conditions());
  const mutations: Array<Partial<ProtocolConditions>> = [
    { querySetId: "qs_2" },
    { querySetVersion: 2 },
    { engines: ["通义千问"] },
    { repetition: 5 },
    { region: "US" },
    { webSearch: false },
    { surface: "official_api" },
    { locationMode: "question_text_only" },
    { anchorId: "anchor_2" },
    { daypart: "lunch" },
  ];
  for (const m of mutations) {
    assert.notEqual(protocolFingerprint(conditions(m)), base, JSON.stringify(m));
  }
});

/* ---------------- 可比性 ---------------- */

test("条件完全一致时可直接对比", () => {
  const r = compareProtocols(conditions(), conditions());
  assert.equal(r.comparable, true);
  assert.deepEqual(r.differences, []);
  assert.match(r.note, /完全一致/);
});

test("联网开关不同判为不可对比（联网与不联网是两个系统）", () => {
  const r = compareProtocols(conditions(), conditions({ webSearch: false }));
  assert.equal(r.comparable, false);
  assert.ok(r.differences.some((d) => d.field === "webSearch" && d.severity === "block"));
  assert.match(r.note, /不可直接对比/);
});

test("平台/界面/定位方式/问题集版本变化都判为不可对比", () => {
  for (const m of [
    { engines: ["通义千问"] },
    { surface: "official_api" as const },
    { locationMode: "question_text_only" },
    { querySetVersion: 2 },
    { anchorId: "anchor_2" },
    { repetition: 5 },
  ]) {
    const r = compareProtocols(conditions(), conditions(m));
    assert.equal(r.comparable, false, JSON.stringify(m));
  }
});

test("地区与模型版本只是警告（平台侧决定，我们无法控制但要记录）", () => {
  const r = compareProtocols(conditions(), conditions({ region: "US", modelVersion: "gpt-6" }));
  assert.equal(r.comparable, true);
  assert.equal(r.differences.filter((d) => d.severity === "warn").length, 2);
  assert.ok(r.differences.every((d) => d.severity === "warn"));
  assert.match(r.note, /非关键条件有差异/);
});

test("时段差异按警告处理（会影响推荐但常无法完全对齐）", () => {
  const r = compareProtocols(conditions(), conditions({ daypart: "lunch" }));
  assert.equal(r.comparable, true);
  assert.ok(r.differences.some((d) => d.field === "daypart" && d.severity === "warn"));
});

test("差异描述是人能读懂的，不是字段名堆砌", () => {
  const r = compareProtocols(conditions(), conditions({ surface: "official_api", webSearch: false }));
  const surface = r.differences.find((d) => d.field === "surface")!;
  assert.equal(surface.baseline, "消费者界面（人工）");
  assert.equal(surface.retest, "官方 API");
  const web = r.differences.find((d) => d.field === "webSearch")!;
  assert.equal(web.baseline, "开启");
  assert.equal(web.retest, "关闭");
});

test("未设置的条件显示为「（未设置）」而不是空白或 undefined", () => {
  const r = compareProtocols(conditions({ region: null }), conditions({ region: "CN" }));
  const region = r.differences.find((d) => d.field === "region")!;
  assert.equal(region.baseline, "（未设置）");
});

/* ---------------- 复制复测协议 ---------------- */

test("复制复测协议时未覆盖的条件原样沿用", () => {
  const base = conditions();
  const cloned = cloneProtocolConditions(base, { region: "US" });
  assert.equal(cloned.region, "US");
  assert.equal(cloned.engines.join(), base.engines.join());
  assert.equal(cloned.webSearch, base.webSearch);
  assert.equal(cloned.querySetVersion, base.querySetVersion);
});

test("复制出的协议默认与来源可比（只改了环境条件）", () => {
  const base = conditions();
  const cloned = cloneProtocolConditions(base, { modelVersion: "gpt-6" });
  assert.equal(compareProtocols(base, cloned).comparable, true);
});

test("复制不会改变来源对象（避免把基线的条件改掉）", () => {
  const base = conditions();
  const snapshot = JSON.stringify(base);
  cloneProtocolConditions(base, { region: "US", daypart: "lunch" });
  assert.equal(JSON.stringify(base), snapshot, "复制必须是无副作用的");
});

/* ---------------- 摘要 ---------------- */

test("协议摘要包含所有影响解读的条件", () => {
  const text = describeProtocol(conditions());
  for (const needle of ["ChatGPT", "消费者界面", "联网", "真实设备定位", "地区 CN", "每问 3 次", "问题集 v1"]) {
    assert.ok(text.includes(needle), `${needle} 未出现在摘要里：${text}`);
  }
});

test("未指定的平台与地区在摘要里也要显式说明", () => {
  const text = describeProtocol(conditions({ engines: [], region: null, modelVersion: null }));
  assert.ok(text.includes("未指定平台"));
  assert.ok(text.includes("地区未指定"));
});

test("平台重复书写不影响指纹（否则同条件会被拆成两份协议）", () => {
  assert.equal(protocolFingerprint(conditions({ engines: ["A", "a"] })), protocolFingerprint(conditions({ engines: ["A"] })));
  assert.equal(protocolFingerprint(conditions({ engines: [" A ", "B", "b"] })), protocolFingerprint(conditions({ engines: ["b", "a"] })));
});

test("模型版本必须进指纹（否则换模型的复测协议建不出来，来源线索也会丢）", () => {
  assert.notEqual(protocolFingerprint(conditions({ modelVersion: "v2" })), protocolFingerprint(conditions({ modelVersion: "v1" })));
  // 但两者仍可对比，只是记为警告
  const r = compareProtocols(conditions({ modelVersion: "v1" }), conditions({ modelVersion: "v2" }));
  assert.equal(r.comparable, true);
  assert.ok(r.differences.some((d) => d.field === "modelVersion" && d.severity === "warn"));
});

test("平台全部重复时摘要显示一次，不会出现「A、A」", () => {
  const text = describeProtocol(conditions({ engines: ["ChatGPT", "chatgpt"] }));
  assert.equal(text.split("ChatGPT").length - 1, 1, text);
});
