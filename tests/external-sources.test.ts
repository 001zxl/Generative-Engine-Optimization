import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_VERDICT_LABEL,
  RECHECK_DAYS,
  SOURCE_KINDS,
  checkExternalSource,
  detectIndependenceMislabel,
  isSourceKind,
  sourceKindLabel,
  summarizeClaimSources,
  type ExternalSourceInput,
} from "../src/lib/external-sources.ts";

/**
 * 第三方信源台账。
 *
 * 核心底线：**不得把自发文章称为独立测评**。
 * 把自家稿件标成"第三方报道"，对客户是虚假背书，对平台可能是误导性陈述。
 */

const NOW = Date.parse("2026-09-25T00:00:00Z");
const DAY = 86_400_000;

function source(over: Partial<ExternalSourceInput> = {}): ExternalSourceInput {
  return {
    id: "src1",
    claimId: "claim1",
    platform: "行业媒体",
    url: "https://media.example/article",
    title: "某公司产能报道",
    topic: "产能",
    kind: "independent",
    publishedAt: "2026-08-01",
    lastCheckedAt: "2026-09-20T00:00:00Z",
    lastStatus: "ok",
    lastHttpStatus: 200,
    ...over,
  };
}

/* ---------------- 来源性质 ---------------- */

test("三类来源性质固定，且只有独立第三方式 independent", () => {
  assert.deepEqual(SOURCE_KINDS.map((k) => k.value), ["owned", "authorized", "independent"]);
  assert.equal(SOURCE_KINDS.find((k) => k.value === "owned")!.independent, false);
  assert.equal(SOURCE_KINDS.find((k) => k.value === "authorized")!.independent, false);
  assert.equal(SOURCE_KINDS.find((k) => k.value === "independent")!.independent, true);
});

test("未知性质如实显示，不冒充已知", () => {
  assert.equal(isSourceKind("weird"), false);
  assert.match(sourceKindLabel("weird"), /未知来源性质/);
  assert.equal(sourceKindLabel("owned"), "自有内容");
});

/* ---------------- 不得把自发文章称为独立测评 ---------------- */

test("自有来源使用「独立测评」等说法即判为阻断", () => {
  for (const phrase of ["独立测评", "第三方报道", "权威认证", "客观评测"]) {
    const issues = detectIndependenceMislabel(`这是一篇${phrase}`, "owned");
    assert.equal(issues.length, 1, phrase);
    assert.match(issues[0].message, /不能称为/);
  }
});

test("授权渠道同样不能自称独立", () => {
  const issues = detectIndependenceMislabel("经第三方评测验证", "authorized");
  assert.equal(issues.length, 1);
});

test("真正的独立第三方可以使用这些说法", () => {
  assert.deepEqual(detectIndependenceMislabel("这是一篇独立测评", "independent"), []);
});

test("措辞检查会进入来源的问题清单", () => {
  const issues = checkExternalSource(source({ kind: "owned", title: "我们的独立测评" }), { now: NOW });
  assert.ok(issues.some((i) => i.code === "mislabel" && i.level === "block"), JSON.stringify(issues));
});

test("备注与主题里的措辞同样会被检查（不只标题）", () => {
  const issues = checkExternalSource(source({ kind: "owned", title: "普通标题", note: "这篇是第三方报道" }), { now: NOW });
  assert.ok(issues.some((i) => i.code === "mislabel"));
});

/* ---------------- 可用性 ---------------- */

test("链接失效判为阻断，并指出引用它会指向 404", () => {
  const issues = checkExternalSource(source({ lastStatus: "dead", lastHttpStatus: 404 }), { now: NOW });
  const dead = issues.find((i) => i.code === "dead")!;
  assert.equal(dead.level, "block");
  assert.match(dead.message, /404/);
});

test("内容与事实不符判为阻断", () => {
  const issues = checkExternalSource(source({ lastStatus: "mismatch" }), { now: NOW });
  assert.ok(issues.some((i) => i.code === "mismatch" && i.level === "block"));
});

test("抓取被拦截只是建议（登录墙无法自动核对）", () => {
  const issues = checkExternalSource(source({ lastStatus: "blocked" }), { now: NOW });
  assert.ok(issues.some((i) => i.code === "blocked" && i.level === "warn"));
});

test("从未核对与超期未核对都会提示", () => {
  const never = checkExternalSource(source({ lastCheckedAt: null, lastStatus: "unknown" }), { now: NOW });
  assert.ok(never.some((i) => i.code === "never_checked"));
  const old = checkExternalSource(source({ lastCheckedAt: new Date(NOW - 200 * DAY).toISOString() }), { now: NOW });
  assert.ok(old.some((i) => i.code === "stale_check"), JSON.stringify(old));
});

test("阈值内的核对不提示超期", () => {
  const fresh = checkExternalSource(source({ lastCheckedAt: new Date(NOW - 10 * DAY).toISOString() }), { now: NOW });
  assert.ok(!fresh.some((i) => i.code === "stale_check"));
  assert.equal(RECHECK_DAYS, 90);
});

test("存在冲突说明时判为阻断", () => {
  const issues = checkExternalSource(source({ conflictNote: "另一来源称产能为 100 吨" }), { now: NOW });
  assert.ok(issues.some((i) => i.code === "conflict" && i.level === "block"));
});

test("未绑定事实只是建议", () => {
  const issues = checkExternalSource(source({ claimId: null }), { now: NOW });
  assert.ok(issues.some((i) => i.code === "unbound" && i.level === "warn"));
});

test("未记录来源性质判为阻断", () => {
  const issues = checkExternalSource(source({ kind: "weird" }), { now: NOW });
  assert.ok(issues.some((i) => i.code === "unknown_kind" && i.level === "block"));
});

/* ---------------- 按事实汇总 ---------------- */

const CLAIM = { id: "claim1", key: "capacity", statement: "月产能 200 吨" };

test("有独立第三方来源 → supported", () => {
  const s = summarizeClaimSources(CLAIM, [source()], { now: NOW });
  assert.equal(s.verdict, "supported");
  assert.equal(s.independent, 1);
  assert.equal(s.usable, 1);
  assert.match(s.note, /独立第三方/);
});

test("只有自有/授权来源 → only_self，并说明不能声称第三方证实", () => {
  const s = summarizeClaimSources(CLAIM, [source({ kind: "owned" }), source({ id: "src2", url: "https://a.example/b", kind: "authorized" })], { now: NOW });
  assert.equal(s.verdict, "only_self");
  assert.equal(s.independent, 0);
  assert.equal(s.usable, 2);
  assert.match(s.note, /不能声称/);
});

test("全部失效 → no_source", () => {
  const s = summarizeClaimSources(CLAIM, [source({ lastStatus: "dead", lastHttpStatus: 404 }), source({ id: "src2", url: "https://a.example/b", lastStatus: "mismatch" })], { now: NOW });
  assert.equal(s.verdict, "no_source");
  assert.equal(s.usable, 0);
  assert.equal(s.unusableSources.length, 2);
  assert.match(s.note, /无据可查/);
});

test("有冲突时结论优先为 conflicting", () => {
  const s = summarizeClaimSources(CLAIM, [source(), source({ id: "src2", url: "https://a.example/b", conflictNote: "数据不一致" })], { now: NOW });
  assert.equal(s.verdict, "conflicting");
  assert.equal(s.hasConflict, true);
  assert.match(s.note, /人工判断/);
});

test("失效来源不会出现在可用清单里（报告只列仍可访问的）", () => {
  const s = summarizeClaimSources(CLAIM, [source(), source({ id: "src2", url: "https://dead.example/x", lastStatus: "dead", lastHttpStatus: 404 })], { now: NOW });
  assert.equal(s.usableSources.length, 1);
  assert.equal(s.usableSources[0].url, "https://media.example/article");
  assert.equal(s.unusableSources.length, 1);
});

test("被误标为独立的来源不计入独立来源数", () => {
  const s = summarizeClaimSources(CLAIM, [source({ kind: "owned", title: "我们的独立测评" })], { now: NOW });
  assert.equal(s.independent, 0);
  assert.equal(s.verdict, "only_self");
});

test("形态完好的独立来源计入独立数", () => {
  const s = summarizeClaimSources(CLAIM, [source({ kind: "independent" })], { now: NOW });
  assert.equal(s.independent, 1);
  assert.equal(s.usableSources[0].label, "独立第三方");
});

test("没有来源时给出无可用来源结论", () => {
  const s = summarizeClaimSources(CLAIM, [], { now: NOW });
  assert.equal(s.verdict, "no_source");
  assert.equal(s.total, 0);
});

test("结论文案可直接展示给客户", () => {
  assert.equal(CLAIM_VERDICT_LABEL.supported, "有独立来源");
  assert.equal(CLAIM_VERDICT_LABEL.only_self, "仅自有来源");
  assert.equal(CLAIM_VERDICT_LABEL.no_source, "无可用来源");
  assert.equal(CLAIM_VERDICT_LABEL.conflicting, "来源冲突");
});
