/**
 * 评估引擎单测。
 *
 * 这套逻辑决定客户看到的每一个指标数字。误判的代价不是"不好看"，而是
 * 客户按错误数字做决策 —— 所以覆盖重点放在边界与"不确定时是否如实标不确定"。
 *
 * 运行：pnpm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  extractFromAnswer,
  computeMetrics,
  checkFactConsistency,
  normalizeDomain,
  type EntityRef,
  type SampleForMetrics,
} from "../src/lib/evaluation.ts";

const ENTITIES: EntityRef[] = [
  { name: "Nordic Profiles", aliases: ["Nordic Profile", "诺迪克"], isTarget: true },
  { name: "AluTech", aliases: [], isTarget: false },
  { name: "MetalWorks", aliases: [], isTarget: false },
];

const OWNED = ["nordic-profiles.se"];

/* ---------------------------- 提及识别 ---------------------------- */

test("识别规范名与别名（含中文别名）", () => {
  const { mentions } = extractFromAnswer(
    "Nordic Profiles 是小批量开模的常见选择。另外 诺迪克 也提供类似服务。",
    ENTITIES,
    OWNED,
  );
  const target = mentions.filter((m) => m.isTarget);
  assert.equal(target.length, 1, "同一实体多次出现应聚合为一条（首次出现）");
  assert.equal(target[0].entity, "Nordic Profiles");
  assert.equal(target[0].matchedText, "Nordic Profiles");
});

test("拉丁词按词边界匹配，不命中词内子串", () => {
  const { mentions } = extractFromAnswer("AluTechzilla is a different company entirely.", ENTITIES);
  assert.equal(mentions.length, 0, "AluTechzilla 不应命中 AluTech");
  const ok = extractFromAnswer("AluTech and MetalWorks are suppliers.", ENTITIES);
  assert.equal(ok.mentions.length, 2);
});

test("大小写不敏感", () => {
  const { mentions } = extractFromAnswer("nordic profiles and ALUTECH both appear.", ENTITIES);
  assert.equal(mentions.length, 2);
});

test("记录首次出现位置，且提及按位置排序", () => {
  const { mentions } = extractFromAnswer("First MetalWorks, then AluTech, finally Nordic Profiles.", ENTITIES);
  assert.deepEqual(
    mentions.map((m) => m.entity),
    ["MetalWorks", "AluTech", "Nordic Profiles"],
  );
  assert.ok(mentions[0].position < mentions[1].position);
});

test("提及带上下文片段，便于人工复核", () => {
  const { mentions } = extractFromAnswer("Some text before. Nordic Profiles is reliable. Some text after.", ENTITIES);
  assert.match(mentions[0].snippet, /Nordic Profiles/);
  assert.match(mentions[0].snippet, /reliable/);
});

test("列表排名：只统计被跟踪实体的相对顺序", () => {
  const answer = [
    "Here are the suppliers:",
    "1. AluTech - large scale",
    "2. Nordic Profiles - small batches",
    "3. MetalWorks - cheapest",
  ].join("\n");
  const { mentions } = extractFromAnswer(answer, ENTITIES);
  const byEntity = Object.fromEntries(mentions.map((m) => [m.entity, m]));
  assert.equal(byEntity["AluTech"].listRank, 1);
  assert.equal(byEntity["Nordic Profiles"].listRank, 2, "目标是列表第 2 个被跟踪实体");
  assert.equal(byEntity["MetalWorks"].listRank, 3);
  assert.ok(byEntity["Nordic Profiles"].inList);
});

test("非列表回答不产生排名（而不是伪造一个排名）", () => {
  const { mentions } = extractFromAnswer("We recommend Nordic Profiles for this use case.", ENTITIES);
  assert.equal(mentions[0].listRank, null);
  assert.equal(mentions[0].inList, false);
});

test("情感判定：有线索才给非中性，且置信度随线索强度变化", () => {
  const pos = extractFromAnswer("Nordic Profiles 是最值得推荐的可靠选择。", ENTITIES).mentions[0];
  assert.equal(pos.sentiment, "positive");
  assert.ok(pos.confidence >= 0.4);

  const neg = extractFromAnswer("避免 Nordic Profiles，投诉多且不可靠、质量差。", ENTITIES).mentions[0];
  assert.equal(neg.sentiment, "negative");

  const neutral = extractFromAnswer("Nordic Profiles 位于瑞典。", ENTITIES).mentions[0];
  assert.equal(neutral.sentiment, "neutral");
  assert.ok(neutral.confidence <= 0.3, "无线索时置信度必须低，不能假装能判断");
});

/* ---------------------------- 引用识别 ---------------------------- */

test("引用识别：完整 URL、裸域名、自有域判定与去重", () => {
  const answer =
    "See https://nordic-profiles.se/moq and also alutech.com plus https://www.alutech.com/about for details.";
  const { citations, urlCount } = extractFromAnswer(answer, ENTITIES, OWNED);

  assert.equal(urlCount, 2, "只有两个是完整 URL");
  const domains = citations.map((c) => c.domain).sort();
  assert.deepEqual(domains, ["alutech.com", "nordic-profiles.se"]);

  const owned = citations.find((c) => c.domain === "nordic-profiles.se");
  assert.equal(owned?.owned, true);
  const third = citations.find((c) => c.domain === "alutech.com");
  assert.equal(third?.owned, false);
});

test("引用识别覆盖各国 ccTLD（回归：曾因 TLD 白名单漏掉 .se）", () => {
  // 目标客户是外贸工厂，.de/.nl/.se/.vn/.th 这类域名是主流形态，不能漏
  const answer = "Suppliers: alu-fertigung.de, profiles.nl, nordic-profiles.se, minhanh.vn, siam.th";
  const { citations } = extractFromAnswer(answer, ENTITIES, OWNED);
  const domains = citations.map((c) => c.domain).sort();
  assert.deepEqual(domains, [
    "alu-fertigung.de",
    "minhanh.vn",
    "nordic-profiles.se",
    "profiles.nl",
    "siam.th",
  ]);
});

test("引用识别不把文件名与缩写当成域名", () => {
  const answer = "See report.pdf and data.csv, notes.txt, app.js, e.g. the spec.md file.";
  const { citations } = extractFromAnswer(answer, ENTITIES, OWNED);
  assert.deepEqual(citations, [], `不应识别出任何域名，实际：${citations.map((c) => c.domain).join(", ")}`);
});

test("normalizeDomain：去 www、转小写、支持子域判定", () => {
  assert.equal(normalizeDomain("https://WWW.Example.COM/path"), "example.com");
  assert.equal(normalizeDomain("Example.com."), "example.com");
  assert.equal(normalizeDomain("  example.com  "), "example.com");

  const { citations } = extractFromAnswer("Source: blog.nordic-profiles.se", ENTITIES, OWNED);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].domain, "blog.nordic-profiles.se");
  assert.equal(citations[0].owned, true, "子域应判定为自有域");
});

/* ---------------------------- 指标计算 ---------------------------- */

function sample(id: string, answer: string, entities = ENTITIES, owned = OWNED): SampleForMetrics {
  const e = extractFromAnswer(answer, entities, owned);
  return { sampleId: id, mentions: e.mentions, citations: e.citations };
}

test("提及率 / 首推率 / SoV / 自有域引用率：分子分母都可追溯", () => {
  const samples = [
    // 目标是列表第 1 位，引用自有域
    sample("s1", "1. Nordic Profiles\n2. AluTech\n\nhttps://nordic-profiles.se/x"),
    // 目标是列表第 2 位，引用第三方
    sample("s2", "1. AluTech\n2. Nordic Profiles\n\nhttps://alutech.com/y"),
    // 完全没有提及，也没有引用
    sample("s3", "No suppliers mentioned here."),
  ];
  const { metrics, notComputable } = computeMetrics(samples);
  assert.deepEqual(notComputable, []);

  const m = Object.fromEntries(metrics.map((x) => [x.metric, x]));

  // 提及率：3 个样本中有 2 个提到目标
  assert.equal(m.mention_rate.numerator, 2);
  assert.equal(m.mention_rate.denominator, 3);

  // 首推率：只有能判断目标排名的样本才进分母（s3 无提及 → 排除）
  assert.equal(m.top1_rate.numerator, 1, "只有 s1 目标排第 1");
  assert.equal(m.top1_rate.denominator, 2);

  // SoV：s1 两个（Nordic+AluTech），s2 两个（AluTech+Nordic）→ 目标 2 / 全部 4
  assert.equal(m.sov.numerator, 2);
  assert.equal(m.sov.denominator, 4);
  assert.ok(Math.abs(m.sov.value - 0.5) < 1e-9);

  // 引用：s1 自有、s2 第三方 → 2 个样本含引用，其中 1 个引用自有域
  assert.equal(m.owned_citation_rate.numerator, 1);
  assert.equal(m.owned_citation_rate.denominator, 2);

  for (const x of metrics) {
    assert.ok(x.basis.length > 10, `${x.metric} 必须带可展示的计算口径`);
    assert.ok(x.value >= 0 && x.value <= 1);
  }
});

test("首推率的分母只含「目标被提及且能判断排名」的样本", () => {
  // s1 目标未出现 → 不计入分母；s2 目标出现但不在列表 → 也不计入
  const samples = [
    sample("s1", "1. AluTech\n2. MetalWorks"),
    sample("s2", "Nordic Profiles is a supplier."),
    sample("s3", "1. Nordic Profiles\n2. AluTech"),
  ];
  const { metrics } = computeMetrics(samples);
  const top1 = metrics.find((x) => x.metric === "top1_rate");
  assert.equal(top1?.denominator, 1, "只有 s3 可判断目标排名");
  assert.equal(top1?.numerator, 1);
});

test("分母为 0 时不得展示成 0，必须标注无法计算", () => {
  const { metrics, notComputable } = computeMetrics([]);
  assert.equal(metrics.length, 0);
  assert.equal(notComputable.length, 4);
  for (const n of notComputable) assert.ok(n.reason.length > 4);
});

test("有样本但无列表、无引用时，相应指标应标无法计算", () => {
  const samples = [sample("s1", "Nordic Profiles 是瑞典企业。")];
  const { metrics, notComputable } = computeMetrics(samples);
  const names = metrics.map((m) => m.metric);
  assert.ok(names.includes("mention_rate"));
  assert.ok(!names.includes("top1_rate"), "无列表不应产出首推率");
  assert.ok(!names.includes("owned_citation_rate"), "无引用不应产出引用率");
  assert.deepEqual(
    notComputable.map((n) => n.metric).sort(),
    ["owned_citation_rate", "top1_rate"],
  );
});

test("样本间不合并不可比口径 —— 由调用方分组保证，这里验证分组后结果不同", () => {
  const groupA = [sample("a1", "1. Nordic Profiles\n2. AluTech")];
  const groupB = [sample("b1", "1. AluTech\n2. Nordic Profiles")];
  const a = computeMetrics(groupA).metrics.find((m) => m.metric === "top1_rate");
  const b = computeMetrics(groupB).metrics.find((m) => m.metric === "top1_rate");
  assert.equal(a?.value, 1);
  assert.equal(b?.value, 0);
});

/* ---------------------------- 事实一致性 ---------------------------- */

test("事实一致性：数值吻合判 consistent", () => {
  const [r] = checkFactConsistency("标准件 500 件起订，交期 12 天。", [
    { claimKey: "moq", statement: "标准件 500 件起订", expectedNumber: { value: 500, unit: "件" } },
  ]);
  assert.equal(r.verdict, "consistent");
  assert.match(r.evidence, /500/);
});

test("事实一致性：同类数值对不上判 conflict，且置信度压低", () => {
  const [r] = checkFactConsistency("起订量大约是 3000 件。", [
    { claimKey: "moq", statement: "标准件 500 件起订", expectedNumber: { value: 500, unit: "件" } },
  ]);
  assert.equal(r.verdict, "conflict");
  assert.ok(r.confidence < 0.5, "数值可能对应其它事实，置信度必须压低");
  assert.match(r.evidence, /3000/);
});

test("事实一致性：无法比对时如实判 unknown，不猜", () => {
  const unknownNoNumber = checkFactConsistency("我们服务很好。", [
    { claimKey: "service", statement: "提供 24 小时客服" },
  ])[0];
  assert.equal(unknownNoNumber.verdict, "unknown");

  const unknownUnit = checkFactConsistency("我们服务很好。", [
    { claimKey: "moq", statement: "500 件起订", expectedNumber: { value: 500, unit: "件" } },
  ])[0];
  assert.equal(unknownUnit.verdict, "unknown");
  assert.match(unknownUnit.evidence, /无法与事实库比对/);
});

test("事实一致性：逐条返回，条数与入参一致", () => {
  const rs = checkFactConsistency("500 件起订，2025 年出货 42 万件。", [
    { claimKey: "moq", statement: "500 件起订", expectedNumber: { value: 500, unit: "件" } },
    { claimKey: "team", statement: "工程师 12 人" },
    { claimKey: "cap", statement: "年出货 42 万件", expectedNumber: { value: 42, unit: "" } },
  ]);
  assert.equal(rs.length, 3);
  assert.deepEqual(rs.map((r) => r.claimKey), ["moq", "team", "cap"]);
});
