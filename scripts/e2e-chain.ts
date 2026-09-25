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
const { evaluateScope } = await import("../src/lib/evaluate-run.ts");

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

console.log("\n[6] 模块5 评估与指标（调用生产编排函数，不重写逻辑）");
// 关键：这里调用的是 Server Action 内部真正执行的同一个函数。
// 之前测试自己重写了一遍评估流程，所以「runId 为空时写入不存在的 run_id」这个
// 缺陷完全没被覆盖 —— 直到真实使用才以 HTTP 500 暴露。
const credited = evaluateScope({ runId: created.runId, brandId });
check("按批次评估成功", credited.ok, JSON.stringify(credited.metrics.map((m) => m.metric)));
check("评估到了全部样本", credited.samples === R.listSamples(created.runId).length, `samples=${credited.samples}`);
check("产出四项指标", credited.metrics.length === 4, JSON.stringify(credited.metrics.map((m) => m.metric)));
const runSnaps = R.listMetricSnapshots(created.runId);
check(
  "每个落库的快照都带可展示的计算口径",
  runSnaps.length > 0 &&
    runSnaps.every((snap) => {
      const d = JSON.parse(snap.dimension_json) as { basis?: string };
      return typeof d.basis === "string" && d.basis.length > 10;
    }),
  `${runSnaps.length} 条快照`,
);

const byMetric = Object.fromEntries(credited.metrics.map((m) => [m.metric, m]));
check("产出提及率", !!byMetric.mention_rate, byMetric.mention_rate && `${byMetric.mention_rate.numerator}/${byMetric.mention_rate.denominator}`);
check("产出首推率", !!byMetric.top1_rate, byMetric.top1_rate && `${byMetric.top1_rate.numerator}/${byMetric.top1_rate.denominator}`);
check("产出 Share of Voice", !!byMetric.sov, byMetric.sov && `${byMetric.sov.numerator}/${byMetric.sov.denominator}`);
check("产出自有域引用率", !!byMetric.owned_citation_rate, byMetric.owned_citation_rate && `${byMetric.owned_citation_rate.numerator}/${byMetric.owned_citation_rate.denominator}`);
// B3 之后每个类目会各存一份快照（另加竞品指标），所以条数必然多于总体指标数。
// 这里要断言的是「总体指标一条不少」，而不是恰好相等。
const runSnapshots = R.listMetricSnapshots(created.runId);
const overallSnaps = runSnapshots.filter((snap) => {
  try {
    return !(JSON.parse(snap.dimension_json) as { category?: string }).category;
  } catch {
    return true;
  }
});
check(
  "总体指标快照一条不少",
  credited.metrics.every((m) => overallSnaps.some((snap) => snap.metric === m.metric)),
  `${overallSnaps.length} 条总体快照 / 共 ${runSnapshots.length} 条`,
);
check(
  "按类目另存了快照（跨协议/跨类目不混算）",
  runSnapshots.some((snap) => {
    try {
      return Boolean((JSON.parse(snap.dimension_json) as { category?: string }).category);
    } catch {
      return false;
    }
  }),
  "存在带 category 维度的快照",
);
check("冲突样本进入人工复核队列", R.countPendingReviews() > 0, `待复核 ${R.countPendingReviews()}`);

/* —— P0 回归：跨批次范围（runId = null）不得写入不存在的 run_id —— */
const crossScope = evaluateScope({ runId: null, brandId });
check("跨批次范围评估成功（runId=null）", crossScope.ok, JSON.stringify(crossScope));
check("跨批次范围标记正确", crossScope.scope === "all_recent", crossScope.scope);
const nullRunSnaps = R.listMetricSnapshots().filter((m) => m.run_id === null);
check("跨批次快照的 run_id 为 NULL（而不是编造的 id）", nullRunSnaps.length > 0, `NULL 快照 ${nullRunSnaps.length} 条`);
const crossDim = nullRunSnaps[0] ? (JSON.parse(nullRunSnaps[0].dimension_json) as { scope?: string; engines?: string[] }) : {};
check("跨批次快照记录了范围与引擎", crossDim.scope === "all_recent" && (crossDim.engines?.length ?? 0) > 0, JSON.stringify(crossDim));
check(
  "不存在任何指向假 run_id 的快照",
  R.listMetricSnapshots().every((m) => m.run_id === null || R.listSamplingRuns().some((r) => r.id === m.run_id)),
);

/* —— 显式拒绝编造外键（防止同类缺陷再次出现）—— */
let fkRejected = false;
try {
  R.saveMetricSnapshot({ runId: "manual", metric: "mention_rate", value: 0.5, numerator: 1, denominator: 2, dimension: {} });
} catch (e) {
  fkRejected = e instanceof Error && /run_id 不存在/.test(e.message);
}
check("写入不存在的 run_id 被显式拒绝并给出可读错误", fkRejected);

/* —— 空范围要给出原因，而不是静默产出 0 —— */
const emptyScope = evaluateScope({ runId: "run_s_不存在的批次", brandId });
check("不存在的批次返回失败与原因", !emptyScope.ok && !!emptyScope.reason, emptyScope.reason);

const mentionOnly = computeMetrics([{ sampleId: "x", mentions: [], citations: [] }]);
check(
  "有样本但零提及时：提及率为 0，其余标注无法计算",
  mentionOnly.metrics.length === 1 &&
    mentionOnly.metrics[0].metric === "mention_rate" &&
    mentionOnly.metrics[0].value === 0 &&
    mentionOnly.notComputable.length === 3,
  `metrics=${mentionOnly.metrics.length}, notComputable=${mentionOnly.notComputable.length}`,
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
