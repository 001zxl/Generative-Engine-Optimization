import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_KINDS,
  EVIDENCE_VERDICT_LABEL,
  assessEvidence,
  checkSampleEvidence,
  evidenceKindLabel,
  isExternalKind,
  type GroupableSample,
  type SampleEvidenceInput,
} from "../src/lib/sample-evidence.ts";

/**
 * 采样证据充分性。
 *
 * 最要紧的两条：
 *  1. fixture / 自己生成的回答**不得**计入外部平台结果
 *  2. 证据不足时必须判"不可判定"，而不是照常给数字
 */

function sample(over: Partial<SampleEvidenceInput> = {}): SampleEvidenceInput {
  return {
    kind: "manual_ui",
    rawAnswer: "推荐 某某菜馆，人均 60。来源：https://example.com/a",
    modelVersion: "v1.2",
    collectedAt: "2026-09-25T10:00:00Z",
    collectedBy: "张三",
    shareUrl: "https://chat.example.com/share/abc",
    screenshotPath: "/shots/abc.png",
    citationUrls: ["https://example.com/a"],
    ...over,
  };
}

/* ---------------- 证据种类 ---------------- */

test("只有消费者界面与官方 API 算外部观察", () => {
  assert.equal(isExternalKind("manual_ui"), true);
  assert.equal(isExternalKind("official_api"), true);
  assert.equal(isExternalKind("fixture"), false);
  assert.equal(isExternalKind(null), false);
  assert.equal(isExternalKind("synthetic"), false, "synthetic 不在白名单，也不算外部观察");
});

test("证据种类里没有 synthetic（数据库 CHECK 也不允许）", () => {
  assert.deepEqual(EVIDENCE_KINDS.map((k) => k.value), ["manual_ui", "official_api", "fixture"]);
});

test("未知来源在标签里如实显示，不假装成已知", () => {
  assert.match(evidenceKindLabel("weird"), /未知来源/);
  assert.equal(evidenceKindLabel("fixture"), "夹具 / 演示数据");
});

/* ---------------- 单条样本 ---------------- */

test("凭据齐全的样本可计入且可追溯", () => {
  const v = checkSampleEvidence(sample());
  assert.equal(v.countable, true, JSON.stringify(v.blockers));
  assert.equal(v.traceable, true);
  assert.deepEqual(v.blockers, []);
});

test("夹具数据不得计入外部平台结果（阻断）", () => {
  const v = checkSampleEvidence(sample({ kind: "fixture" }));
  assert.equal(v.countable, false);
  assert.ok(v.blockers.some((b) => b.includes("不是外部平台的真实回答")), JSON.stringify(v.blockers));
});

test("缺少来源记录时阻断", () => {
  const v = checkSampleEvidence(sample({ kind: null }));
  assert.equal(v.countable, false);
  assert.ok(v.blockers.some((b) => b.includes("未记录证据来源")));
});

test("没有原文/模型版本/采集时间都阻断", () => {
  for (const over of [{ rawAnswer: "  " }, { modelVersion: null }, { collectedAt: null }]) {
    const v = checkSampleEvidence(sample(over));
    assert.equal(v.countable, false, JSON.stringify(over));
    assert.ok(v.blockers.length > 0);
  }
});

test("缺分享链接/截图/引用/采样人员只是建议，不阻断但不可追溯", () => {
  const v = checkSampleEvidence(sample({ shareUrl: null, screenshotPath: null, citationUrls: [], collectedBy: null }));
  assert.equal(v.countable, true, JSON.stringify(v.blockers));
  assert.equal(v.traceable, false, "没有链接也没有截图 → 不可追溯");
  assert.equal(v.warnings.length, 4, JSON.stringify(v.warnings));
});

test("只有截图没有链接也算可追溯（现场拍照是有效凭据）", () => {
  const v = checkSampleEvidence(sample({ shareUrl: null }));
  assert.equal(v.traceable, true);
  assert.ok(v.warnings.some((w) => w.includes("分享链接")));
});

/* ---------------- 分组充分性 ---------------- */

function groupable(over: Partial<GroupableSample> = {}): GroupableSample {
  return { protocolId: "proto_1", surface: "manual_ui", locationMode: "device_location", webSearch: true, countable: true, traceable: true, ...over };
}

test("样本量达标且证据链完整 → 证据充分", () => {
  const r = assessEvidence(Array.from({ length: 12 }, () => groupable()));
  assert.equal(r.verdict, "sufficient");
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].countable, 12);
});

test("样本量不足 → 样本量不足（并给出实际条数）", () => {
  const r = assessEvidence(Array.from({ length: 4 }, () => groupable()));
  assert.equal(r.verdict, "insufficient");
  assert.ok(r.groups[0].reasons.some((x) => x.includes("少于 10 条")), JSON.stringify(r.groups[0].reasons));
  assert.match(r.groups[0].note, /只能作为观察/);
});

test("一条可信样本都没有 → 不可判定", () => {
  const r = assessEvidence(Array.from({ length: 12 }, () => groupable({ countable: false })));
  assert.equal(r.verdict, "not_judgeable");
  assert.match(r.groups[0].note, /无法判定/);
});

test("凭证比例过低 → 判为不足，即使样本量够", () => {
  const samples = [
    ...Array.from({ length: 10 }, () => groupable()),
    ...Array.from({ length: 10 }, () => groupable({ traceable: false })),
  ];
  const r = assessEvidence(samples);
  assert.equal(r.verdict, "insufficient");
  assert.ok(r.groups[0].reasons.some((x) => x.includes("截图凭证")), JSON.stringify(r.groups[0].reasons));
});

test("未绑定协议的组单独提示无法对比", () => {
  const r = assessEvidence(Array.from({ length: 12 }, () => groupable({ protocolId: null })));
  assert.ok(r.groups[0].reasons.some((x) => x.includes("未绑定采样协议")), JSON.stringify(r.groups[0].reasons));
});

test("不同界面/定位方式/联网状态必须分开分组，不能合并", () => {
  const samples = [
    ...Array.from({ length: 6 }, () => groupable()),
    ...Array.from({ length: 6 }, () => groupable({ surface: "official_api" })),
    ...Array.from({ length: 6 }, () => groupable({ locationMode: "question_text_only" })),
    ...Array.from({ length: 6 }, () => groupable({ webSearch: false })),
  ];
  const r = assessEvidence(samples);
  assert.equal(r.groups.length, 4, JSON.stringify(r.groups.map((g) => g.key)));
  // 每组 6 条 < 10，全部不足 —— 合并成 24 条会得出"充分"的错误结论
  assert.equal(r.verdict, "insufficient");
  assert.ok(r.groups.every((g) => g.total === 6));
});

test("没有任何样本时判不可判定", () => {
  const r = assessEvidence([]);
  assert.equal(r.verdict, "not_judgeable");
  assert.match(r.note, /还没有任何样本/);
});

test("整体结论取最差的一组（不因多数组达标而放松）", () => {
  const samples = [
    ...Array.from({ length: 12 }, () => groupable()),
    ...Array.from({ length: 2 }, () => groupable({ surface: "official_api" })),
  ];
  const r = assessEvidence(samples);
  assert.equal(r.verdict, "insufficient");
  assert.match(r.note, /存在证据不足的组/);
});

test("判定文案可直接展示给客户", () => {
  assert.equal(EVIDENCE_VERDICT_LABEL.not_judgeable, "不可判定");
  assert.equal(EVIDENCE_VERDICT_LABEL.insufficient, "样本量不足");
  assert.equal(EVIDENCE_VERDICT_LABEL.sufficient, "证据充分");
});

test("最小样本量可配置，不写死", () => {
  const r = assessEvidence(Array.from({ length: 5 }, () => groupable()), { minPerGroup: 5 });
  assert.equal(r.verdict, "sufficient");
});

test("凭证比例阈值默认 80%：一半样本没凭据不足以对外出报告", () => {
  const half = [...Array.from({ length: 10 }, () => groupable()), ...Array.from({ length: 10 }, () => groupable({ traceable: false }))];
  assert.equal(assessEvidence(half).verdict, "insufficient");

  // 8/10 达标即通过
  const eighty = [...Array.from({ length: 8 }, () => groupable()), ...Array.from({ length: 2 }, () => groupable({ traceable: false }))];
  assert.equal(assessEvidence(eighty).verdict, "sufficient");

  // 7/10 不通过（边界是严格小于）
  const seventy = [...Array.from({ length: 7 }, () => groupable()), ...Array.from({ length: 3 }, () => groupable({ traceable: false }))];
  assert.equal(assessEvidence(seventy).verdict, "insufficient");
});

test("整体说明必须写出具体差在哪（不能只说「不足」）", () => {
  const r = assessEvidence(Array.from({ length: 3 }, () => groupable()));
  assert.match(r.note, /少于 10 条/, r.note);
});

test("凭据不足时说明里带上凭证比例", () => {
  const samples = [...Array.from({ length: 12 }, () => groupable()), ...Array.from({ length: 8 }, () => groupable({ traceable: false }))];
  const r = assessEvidence(samples);
  assert.match(r.note, /截图凭证|带链接/, r.note);
});
