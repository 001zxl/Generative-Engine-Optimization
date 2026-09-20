/**
 * 核心业务链路的集成测试：品牌 → 问题库（冻结）→ 采样 → 评估 → 指标。
 *
 * 为什么不走 HTTP：这些写入走的是 Server Actions（Next 的 RPC 协议），
 * 从脚本调用需要伪造 action id，脆且无意义。这里直接调用同一套仓储与评估函数 ——
 * 也就是 Server Action 内部真正执行的那段代码。
 *
 * 运行：node scripts/e2e-chain.ts   （使用临时数据库，不触碰 data/geo.db）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* —— 必须在导入仓储之前设置数据库路径 —— */
const TMP_DB = path.join(os.tmpdir(), `geo-chain-${Date.now()}.db`);
process.env.DATABASE_PATH = TMP_DB;
process.env.DEFAULT_WORKSPACE_SLUG = "default";

const R = await import("../src/lib/db/repo-domains.ts");
const { extractFromAnswer, computeMetrics, checkFactConsistency } = await import("../src/lib/evaluation.ts");
const { getDb } = await import("../src/lib/db/index.ts");

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  const suffix =
    detail === undefined ? "" : "  -> " + (typeof detail === "string" ? detail : JSON.stringify(detail));
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${suffix}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${suffix}`);
  }
}

console.log("\n[1] 模块1 品牌 / 别名 / 竞品");
const brandId = R.createBrand({ name: "Nordic Profiles", domain: "nordic-profiles.se", description: "铝型材定制加工" });
R.addAlias(brandId, "Nordic Profile");
R.addAlias(brandId, "诺迪克");
R.addCompetitor(brandId, "AluTech", "alutech.com");
R.addCompetitor(brandId, "MetalWorks", "metalworks.de");
const ctx = R.getBrandContext(brandId);
check("品牌已创建", !!ctx, ctx?.brandName);
check("别名已录入", ctx?.entities[0].aliases.length === 2, JSON.stringify(ctx?.entities[0].aliases));
check("竞品已录入", ctx?.entities.filter((e) => !e.isTarget).length === 2);
check("自有域提取正确", ctx?.ownedDomains[0] === "nordic-profiles.se", JSON.stringify(ctx?.ownedDomains));

console.log("\n[2] 模块2 问题库 + 冻结");
const qsId = R.createQuerySet("海外买家监测集 V1", brandId);
const add1 = R.addQuestions(qsId, [
  "Who are reliable aluminum profile manufacturers in China for a 500-unit trial order?",
  "Which Chinese suppliers handle small MOQ orders?",
  "铝合金型材最小起订量一般是多少？",
  " aluminium profile ", // 与上一条去重后仍应保留（不同文本）
]);
check("批量添加问题", add1.added === 4, `added=${add1.added}`);
const dedup = R.addQuestions(qsId, ["Which Chinese suppliers handle small MOQ orders?"]);
check("跨批次重复问题被去重", dedup.added === 0 && dedup.skippedDuplicate === 1, JSON.stringify(dedup));
const afterDedup = R.listQuestions(qsId).length;
check("问题集内无重复行", afterDedup === 4, `实际 ${afterDedup} 条`);

const frozen = R.freezeQuerySet(qsId);
check("冻结成功", frozen.ok, JSON.stringify(frozen));
const afterFreeze = R.addQuestions(qsId, ["这条不应写进去"]);
check("冻结后拒绝写入", afterFreeze.skippedFrozen && afterFreeze.added === 0, JSON.stringify(afterFreeze));
const qs = R.listQuerySets().find((q) => q.id === qsId);
check("问题集状态为 frozen", qs?.status === "frozen", qs?.status);
const emptyQs = R.createQuerySet("空集");
const emptyFreeze = R.freezeQuerySet(emptyQs);
check("空问题集拒绝冻结", !emptyFreeze.ok, emptyFreeze.reason);

console.log("\n[3] 模块3 事实与证据（仅已批准参与评估）");
const claimId = R.createClaim({ claimKey: "moq", statement: "标准规格 500 件起订", category: "交付" });
R.addEvidence({ claimId, title: "GB/T 5237 标准", url: "https://example.org/std", evidenceLevel: "official" });
R.createClaim({ claimKey: "moq", statement: "起订量可以商量，没有下限", category: "交付" });
const conflicts = R.listClaimConflicts();
check("检测到同 key 的事实冲突", conflicts.length === 1, JSON.stringify(conflicts[0]?.claim_key));
check("未批准的事实不进入比对集", R.getApprovedClaims().length === 0);
R.reviewClaim(claimId, "approved");
const approved = R.getApprovedClaims();
check("批准后进入比对集", approved.length === 1, JSON.stringify(approved[0]));
check("从陈述中解析出数值", approved[0].expectedNumber?.value === 500, JSON.stringify(approved[0].expectedNumber));

console.log("\n[4] 模块4 采样（人工粘贴）");
const engines = R.listEngines();
check("引擎清单已播种", engines.length >= 12, `${engines.length} 个`);
check("国内平台标注为无公开 API", engines.filter((e) => e.region === "cn").every((e) => e.has_public_api === 0));
const created = R.createSamplingRun({
  label: "2026-09 基线",
  querySetId: qsId,
  samplingMode: "manual_ui",
  engines: ["ChatGPT", "豆包"],
  region: "DE",
  repetition: 1,
});
check("生成采样任务", created.tasks === 4 * 2, `tasks=${created.tasks}（4 问 × 2 引擎）`);
const tasks = R.listSamplingTasks(created.runId);
check("幂等键防止重复任务", tasks.length === created.tasks);

const ANSWERS: Record<string, string> = {
  "Who are reliable aluminum profile manufacturers in China for a 500-unit trial order?":
    "1. AluTech — large volume specialist\n2. Nordic Profiles — handles 500-unit trial orders, MOQ 500 件起订\n3. MetalWorks — cheapest\n\nSources: https://alutech.com/catalog and https://nordic-profiles.se/moq",
  "Which Chinese suppliers handle small MOQ orders?":
    "Nordic Profiles (https://nordic-profiles.se) is known for small MOQ. AluTech 也做，但起订量大约是 3000 件。",
  "铝合金型材最小起订量一般是多少？": "一般 500 件起订，具体看工艺。推荐 Nordic Profiles。",
  "aluminium profile": "AluTech and MetalWorks are options. Avoid Nordic Profiles if you need fast delivery — complaints reported.",
};
let saved = 0;
for (const t of tasks) {
  const ans = ANSWERS[t.question_text];
  if (!ans) continue;
  R.saveSample({ taskId: t.id, rawAnswer: ans, modelVersion: t.engine === "ChatGPT" ? "gpt-5.2" : "doubao-1.5" });
  saved++;
}
check("样本已保存", saved === created.tasks, `saved=${saved}`);
const samples = R.listSamples(created.runId);
check("样本可列出且带问题原文", samples.length === created.tasks, `${samples.length} 条`);
check("记录采样方式", samples.every((s) => s.sampling_mode === "manual_ui"));

console.log("\n[5] CSV 导入");
const csv = `question,engine,answer
Who are reliable aluminum profile manufacturers in China for a 500-unit trial order?,Kimi,"北欧的 Nordic Profiles 可以小批量，https://nordic-profiles.se"
Which Chinese suppliers handle small MOQ orders?,通义千问,AluTech 起订 3000 件。
`;
const imp = R.importSamplesCsv(created.runId, csv);
check("CSV 导入成功", imp.imported === 2, `imported=${imp.imported}, errors=${JSON.stringify(imp.errors)}`);
const badCsv = `question,engine,answer\n某个不存在于问题集的问题,ChatGPT,内容`;
const imp2 = R.importSamplesCsv(created.runId, badCsv);
check("不属于该问题集的行被拒绝并报错", imp2.imported === 0 && imp2.errors.length === 1, JSON.stringify(imp2.errors));

console.log("\n[6] 模块5 评估与指标");
const entities = ctx!.entities;
const forMetrics = [];
for (const s of R.listSamples(created.runId)) {
  const ex = extractFromAnswer(s.raw_answer, entities, ctx!.ownedDomains);
  R.saveEvaluation({ sampleId: s.id, evaluator: "mentions", version: "1.0.0", result: ex.mentions, confidence: 0.8 });
  R.saveEvaluation({ sampleId: s.id, evaluator: "citations", version: "1.0.0", result: ex.citations, confidence: 0.9 });
  const facts = checkFactConsistency(s.raw_answer, R.getApprovedClaims());
  const hasConflict = facts.some((f) => f.verdict === "conflict");
  R.saveEvaluation({
    sampleId: s.id,
    evaluator: "facts",
    version: "1.0.0",
    result: facts,
    confidence: hasConflict ? 0.35 : 0.55,
    needsReview: hasConflict,
  });
  forMetrics.push({ sampleId: s.id, mentions: ex.mentions, citations: ex.citations });
}
const { metrics, notComputable } = computeMetrics(forMetrics);
for (const m of metrics) {
  R.saveMetricSnapshot({
    runId: created.runId,
    metric: m.metric,
    value: m.value,
    numerator: m.numerator,
    denominator: m.denominator,
    dimension: { basis: m.basis },
  });
}
const byMetric = Object.fromEntries(metrics.map((m) => [m.metric, m]));
check("产出提及率", !!byMetric.mention_rate, byMetric.mention_rate && `${byMetric.mention_rate.numerator}/${byMetric.mention_rate.denominator}`);
check("产出首推率", !!byMetric.top1_rate, byMetric.top1_rate && `${byMetric.top1_rate.numerator}/${byMetric.top1_rate.denominator}`);
check("产出 Share of Voice", !!byMetric.sov, byMetric.sov && `${byMetric.sov.numerator}/${byMetric.sov.denominator}`);
check("产出自有域引用率", !!byMetric.owned_citation_rate, byMetric.owned_citation_rate && `${byMetric.owned_citation_rate.numerator}/${byMetric.owned_citation_rate.denominator}`);
check("每个指标都带计算口径", metrics.every((m) => m.basis.length > 10));
check("指标快照已落库", R.listMetricSnapshots(created.runId).length === metrics.length);
check("冲突样本进入人工复核队列", R.countPendingReviews() > 0, `待复核 ${R.countPendingReviews()}`);
const noData = computeMetrics([]);
check("完全无样本时四项指标全部标注无法计算", noData.metrics.length === 0 && noData.notComputable.length === 4);
// 有样本但样本里什么都没提到时，提及率是真实的 0%（可计算），
// 而首推率/SoV/引用率无从计算 —— 两者必须区分开
const zeroMention = computeMetrics([{ sampleId: "x", mentions: [], citations: [] }]);
check(
  "有样本但零提及时：提及率为 0，其余标注无法计算",
  zeroMention.metrics.length === 1 &&
    zeroMention.metrics[0].metric === "mention_rate" &&
    zeroMention.metrics[0].value === 0 &&
    zeroMention.notComputable.length === 3,
  `metrics=${zeroMention.metrics.length}, notComputable=${zeroMention.notComputable.length}`,
);

console.log("\n[7] 模块6 内容与发布");
const briefId = R.createBrief({ title: "小批量开模指南", gapReason: "问题「500 件能开模吗」我们 0 次出现" });
R.createChannel("owned", "官网博客");
const channels = R.listChannels();
const assetId = R.createAsset({
  briefId,
  title: "铝合金型材最小起订量（MOQ）怎么算",
  bodyMd: "标准规格 500 件起订……",
  author: "张工",
  questionIds: [R.listQuestions(qsId)[0].id],
  claimIds: [claimId],
});
R.reviewAsset(assetId, "approved");
const beforePub = R.listAssets().find((a) => a.id === assetId);
check("内容审核通过", beforePub?.status === "approved", beforePub?.status);
R.publishAsset(assetId, "https://nordic-profiles.se/blog/moq", channels[0]?.id);
const afterPub = R.listAssets().find((a) => a.id === assetId);
check("发布后状态更新", afterPub?.status === "published", afterPub?.status);
check("发布记录已回填 URL", R.listPublications().length === 1, R.listPublications()[0]?.url);
const linkCheck = getDb()
  .prepare("SELECT COUNT(*) AS n FROM content_claim_links WHERE asset_id = ?")
  .get(assetId) as { n: number };
check("内容与已批准事实建立了绑定", linkCheck.n === 1, `links=${linkCheck.n}`);

console.log("\n[8] 模块7 获客归因");
const db = getDb();
const ws = (db.prepare("SELECT id FROM workspaces WHERE slug='default'").get() as { id: string }).id;
db.prepare(
  "INSERT INTO leads (id, workspace_id, email, name, company, status, first_touch_json, created_at, updated_at) VALUES ('lead_t1',?,?,?,?,'new',?,?,?)",
).run(ws, "buyer@example-eu.com", "Anna", "Nordic AB", JSON.stringify({ landingPath: "/tools/ai-crawler-check" }), new Date().toISOString(), new Date().toISOString());

R.addTouchpoint({ leadId: "lead_t1", kind: "first_touch", path: "/tools/ai-crawler-check" });
R.addTouchpoint({ leadId: "lead_t1", kind: "self_reported", note: "AI 回答里看到的" });
R.updateLeadStatus("lead_t1", "contacted", "已发邮件");
R.updateLeadStatus("lead_t1", "qualified", "确认需求");
const hist = R.listLeadHistory("lead_t1");
check("状态流转写入历史", hist.length === 2, `history=${hist.length}`);
check("历史含 from→to", hist.some((h) => h.from_status === "contacted" && h.to_status === "qualified"));
const attr = R.getAttributionSummary();
check("归属：First Touch 可查", attr.firstTouch.length > 0, JSON.stringify(attr.firstTouch[0]));
check("归属：自述来源可查", attr.selfReported.some((r) => r.label === "(未填写)") || attr.selfReported.length > 0);
check("归属：状态分布可查", attr.byStatus.some((r) => r.status === "qualified"));

/* —— 清理 —— */
try {
  fs.rmSync(TMP_DB, { force: true });
  fs.rmSync(TMP_DB + "-wal", { force: true });
  fs.rmSync(TMP_DB + "-shm", { force: true });
} catch {
  /* 忽略 */
}

console.log("\n" + "=".repeat(60));
console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
