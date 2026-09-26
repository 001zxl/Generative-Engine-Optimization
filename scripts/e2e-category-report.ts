/**
 * B3 验收：三类结果分开展示、归因可核对、来源不明保持「未知」。
 *
 * 只跑在全新临时库上。用法：
 *   AUTH_SECRET=... node --experimental-strip-types scripts/e2e-category-report.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>
 */
import path from "node:path";

const [DB, BASE, PASSWORD] = process.argv.slice(2);
if (!DB || !BASE || !PASSWORD) {
  console.error("用法：node scripts/e2e-category-report.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>");
  process.exit(1);
}
const resolved = path.resolve(DB);
if (resolved === path.join(process.cwd(), "data", "geo.db")) {
  console.error("拒绝在试点库上运行。");
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;
process.env.CONSOLE_PASSWORD = PASSWORD;

const { getDb } = await import("../src/lib/db/index.ts");
const existing = (getDb().prepare("SELECT COUNT(*) AS n FROM response_samples").get() as { n: number }).n;
if (existing > 0) {
  console.error(`该库已有 ${existing} 条样本，请在全新库上运行。`);
  process.exit(1);
}

const R = await import("../src/lib/db/repo-domains.ts");
const P = await import("../src/lib/db/repo-protocol.ts");
const EV = await import("../src/lib/db/repo-eval-samples.ts");
const { computeMetricsByCategory, computeCitationSourceBlock } = await import("../src/lib/category-metrics.ts");
const { buildLeadAttribution, UNKNOWN_LABEL } = await import("../src/lib/lead-attribution.ts");

let pass = 0;
const failed: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  -> " + detail : ""}`);
  } else {
    failed.push(name);
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
};

/* ---------- 准备：三类问题各若干条 ---------- */
const brandId = R.createBrand({ name: "归因验收品牌", domain: "attr.example" });
R.addCompetitor(brandId, "竞品甲公司", "rival.example");
const qsId = R.createQuerySet("归因验收问题集", brandId);
R.addQuestions(qsId, [
  "归因验收品牌 靠谱吗？",
  "归因验收品牌 是什么？",
  "附近有什么好的服务商？",
  "附近推荐一家服务商？",
  "预算有限该选哪家服务商？",
]);
const qids = R.listQuestions(qsId).map((q) => q.id);
const categories = ["branded_awareness", "branded_awareness", "unbranded_recommendation", "unbranded_recommendation", "comparison_scenario"];
for (let i = 0; i < qids.length; i++) P.setQuestionCategory(qids[i], categories[i]);
R.freezeQuerySet(qsId);

const proto = P.createProtocol({
  label: "归因验收协议", querySetId: qsId, engines: ["FixtureAI"], repetition: 1, region: "CN",
  webSearch: true, surface: "manual_ui", locationMode: "device_location", anchorId: null, daypart: "dinner", modelVersion: null,
});
const run = R.createSamplingRun({
  label: "归因验收批次", querySetId: qsId, samplingMode: "manual_ui", engines: ["FixtureAI"],
  protocolId: proto.id, webSearch: true, locationMode: "device_location", daypart: "dinner",
});

// 认知题：都提到品牌（这是必然的）；推荐题：只有一条提到
const answers = [
  "1. 归因验收品牌 — 很专业\n2. 竞品甲公司 — 一般",
  "归因验收品牌 是一家服务商，提供相关服务。",
  "附近的推荐：竞品甲公司、竞品乙公司。",
  "没有找到合适的服务商。",
  "预算有限可以考虑 归因验收品牌，来源：https://attr.example/pricing",
];
const tasks = R.listSamplingTasks(run.runId);
for (let i = 0; i < tasks.length; i++) {
  R.saveSample({ taskId: tasks[i].id, rawAnswer: answers[i] ?? "无内容" });
}

console.log("== 1. 三类结果分开计算 ==");
const { evaluateScope } = await import("../src/lib/evaluate-run.ts");
const ev = evaluateScope({ brandId, runId: run.runId });
check("评估成功", ev.ok, JSON.stringify(ev.notComputable ?? []));
check("返回了按类目的结果", (ev.byCategory ?? []).length >= 3, JSON.stringify((ev.byCategory ?? []).map((b) => b.category)));
const branded = (ev.byCategory ?? []).find((b) => b.category === "branded_awareness")!;
const unbranded = (ev.byCategory ?? []).find((b) => b.category === "unbranded_recommendation")!;
const scenario = (ev.byCategory ?? []).find((b) => b.category === "comparison_scenario")!;
check("认知题块存在且有样本", (branded?.sampleCount ?? 0) === 2, String(branded?.sampleCount));
check("推荐题块存在且有样本", (unbranded?.sampleCount ?? 0) === 2, String(unbranded?.sampleCount));
check("场景题块存在且有样本", (scenario?.sampleCount ?? 0) === 1, String(scenario?.sampleCount));
check("认知题不计入推荐判断", branded?.countsTowardRecommendation === false);
check("推荐题计入推荐判断", unbranded?.countsTowardRecommendation === true);

const brandedMention = branded.metrics.find((m) => m.metric === "mention_rate")!;
const unbrandedMention = unbranded.metrics.find((m) => m.metric === "mention_rate")!;
check("认知题提及率 2/2", brandedMention.numerator === 2 && brandedMention.denominator === 2, `${brandedMention.numerator}/${brandedMention.denominator}`);
// 夹具里两条推荐题答案都没提品牌 → 0/2 才是正确结果
check("推荐题提及率 0/2", unbrandedMention.numerator === 0 && unbrandedMention.denominator === 2, `${unbrandedMention.numerator}/${unbrandedMention.denominator}`);
check("两类提及率不同（证明没有混算）", brandedMention.value !== unbrandedMention.value, `${brandedMention.value} vs ${unbrandedMention.value}`);
// 若把三类混在一起算，提及率会变成 3/5 —— 认知题把数字抬高了
const mixed = (brandedMention.numerator + unbrandedMention.numerator + (scenario.metrics.find((m) => m.metric === "mention_rate")?.numerator ?? 0)) /
  (brandedMention.denominator + unbrandedMention.denominator + (scenario.metrics.find((m) => m.metric === "mention_rate")?.denominator ?? 0));
check("混算会把提及率抬高（所以必须分开）", mixed > unbrandedMention.value, `混算 ${mixed.toFixed(2)} vs 推荐题 ${unbrandedMention.value.toFixed(2)}`);

console.log("== 2. 竞品出现率 ==");
check("推荐题块有竞品指标", !!unbranded.competitor, JSON.stringify(unbranded.competitor));
check("竞品出现在 1/2 推荐题样本中", unbranded.competitor?.numerator === 1, JSON.stringify(unbranded.competitor));
check("列出竞品实体与样本数", (unbranded.competitor?.byEntity ?? []).length > 0, JSON.stringify(unbranded.competitor?.byEntity));

console.log("== 3. 指标按类目落库 ==");
const snaps = R.listMetricSnapshots(run.runId);
const dims = snaps.map((s) => { try { return JSON.parse(s.dimension_json) as { category?: string }; } catch { return {}; } });
check("快照带类目维度", dims.some((d) => d.category === "branded_awareness"), JSON.stringify(dims.map((d) => d.category)));
check("快照带推荐判断标记", dims.some((d) => d.category === "unbranded_recommendation" && (d as { countsTowardRecommendation?: boolean }).countsTowardRecommendation === true));
check("竞品指标已落库", snaps.some((s) => s.metric === "competitor_mention_rate"));

console.log("== 4. 引用来源单独成块 ==");
const catMap = P.categoryByQuestionId();
const categorized = EV.listCategorySamples(catMap);
const citationBlock = computeCitationSourceBlock(categorized.map((c) => ({ citations: c.citations })));
check("引用块给出分母", citationBlock.denominator > 0, String(citationBlock.denominator));
check("自有来源被识别", citationBlock.ownedNumerator >= 1, `${citationBlock.ownedNumerator}/${citationBlock.denominator}`);
check("按域名排行且自有优先", citationBlock.byDomain.length > 0 && citationBlock.byDomain[0].owned, JSON.stringify(citationBlock.byDomain));

console.log("== 5. 线索归因：缺失保持「未知」 ==");
const bare = buildLeadAttribution({ source: null, selfReportedSource: null, firstTouchJson: null });
check("毫无记录时渠道为未知", bare.channel === UNKNOWN_LABEL);
check("逐项列出未知", bare.unknown.includes("渠道") && bare.unknown.includes("落地页") && bare.unknown.includes("渠道参数（utm）"));
check("complete 为假", !bare.complete);

const full = buildLeadAttribution({
  source: "result:ai-crawler-check",
  selfReportedSource: "朋友推荐",
  firstTouchJson: JSON.stringify({ referrer: "https://zhihu.com/q/1", landingPath: "/r/abc", utm: { utm_medium: "social", utm_campaign: "wx" } }),
  contentTitle: "某篇文章",
  storeName: "某门店",
});
check("信息齐全时 complete 为真", full.complete, JSON.stringify(full.unknown));
check("渠道取 utm_medium", full.channel === "social", full.channel);
check("保留落地页与 utm", full.landingPath === "/r/abc" && full.utm.utm_campaign === "wx");
check("有引荐域名的渠道可读", full.referrerHost === "zhihu.com");

const noUtm = buildLeadAttribution({ source: null, selfReportedSource: "搜索", firstTouchJson: JSON.stringify({ referrer: "https://google.com" }) });
check("没有 utm 时渠道仍可知但 utm 标未知", /引荐/.test(noUtm.channel) && noUtm.unknown.includes("渠道参数（utm）"), noUtm.channel);

console.log("== 6. 报告页展示三类结果与归因字段 ==");
const { createSessionToken, COOKIE_NAME } = await import("../src/lib/auth.ts");
const cookie = `${COOKIE_NAME}=${await createSessionToken()}`;
const L = await import("../src/lib/db/repo-local.ts");
const storeId = L.createStore({ name: "归因验收门店", city: "示例市" });

/** React 在相邻文本节点之间插入 <!-- --> 分隔符，直接子串匹配会漏 */
const visible = (raw: string) => raw.replace(/<!--.*?-->/g, "");

const { createLead } = await import("../src/lib/db/repo.ts");
// 一条信息齐全的线索 + 一条什么都没记录的线索
createLead({
  email: "full@buyer.example",
  name: "完整线索",
  selfReportedSource: "朋友推荐",
  source: "result:ai-crawler-check",
  firstTouch: { referrer: "https://zhihu.com/q/1", landingPath: "/r/abc", utm: { utm_medium: "social" } },
});
createLead({ email: "bare@buyer.example", name: "信息缺失线索" });

let res = await fetch(`${BASE}/console/geo-report?store=${storeId}`, { headers: { cookie } });
let html = visible(await res.text());
check("报告页 200", res.status === 200, `HTTP ${res.status}`);
check("显示三类结果标题", html.includes("三类结果"));
check("显示认知题块", html.includes("认知题"));
check("显示推荐题块", html.includes("推荐题"));
check("显示分子/分母", /\d+\s*\/\s*\d+/.test(html), (html.match(/\d+\s*\/\s*\d+/) ?? [""])[0]);
check("显示竞品出现率", html.includes("竞品出现率"));
check("显示引用来源块", html.includes("引用来源"));
check("标注认知题不计入推荐判断", html.includes("不计入推荐判断"));

res = await fetch(`${BASE}/console/leads`, { headers: { cookie } });
html = visible(await res.text());
check("线索页 200", res.status === 200, `HTTP ${res.status}`);
check("线索页按新口径显示渠道", html.includes("渠道："));
check("线索页显示落地页", html.includes("落地页："));
check("线索页显示未知项", html.includes("未知项"), "信息缺失的线索必须列出未知项");
check("线索页显示自述来源", html.includes("自述："));
check("信息齐全的线索渠道取 utm", html.includes("渠道：social"), "utm_medium 优先");
check("缺失渠道显示为未知而不是空白", html.includes("渠道：未知") || html.includes("未知项"), "");

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
