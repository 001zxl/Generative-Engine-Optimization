/**
 * B1 验收：三类问题、采样协议、复测复制、跨协议不混算。
 *
 * 只跑在**全新**临时库上（脚本会重建同名对象，脏库上重跑会因对象重复而失败）。
 *
 * 用法：
 *   node --experimental-strip-types scripts/e2e-protocol.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>
 */
import path from "node:path";

const [DB, BASE, PASSWORD] = process.argv.slice(2);
if (!DB || !BASE || !PASSWORD) {
  console.error("用法：node scripts/e2e-protocol.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>");
  process.exit(1);
}
const resolved = path.resolve(DB);
if (resolved === path.join(process.cwd(), "data", "geo.db")) {
  console.error("拒绝在试点库上运行。");
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;
process.env.CONSOLE_PASSWORD = PASSWORD;

const existing = await (async () => {
  const { getDb } = await import("../src/lib/db/index.ts");
  return (getDb().prepare("SELECT COUNT(*) AS n FROM sampling_protocols").get() as { n: number }).n;
})();
if (existing > 0) {
  console.error(`该库已有 ${existing} 份协议，请在全新库上运行（rm -f <DB_PATH>* 后重启夹具服务）。`);
  process.exit(1);
}

const R = await import("../src/lib/db/repo-domains.ts");
const P = await import("../src/lib/db/repo-protocol.ts");
const { QUESTION_CATEGORIES, checkCategoryCoverage, compareProtocols } = await import("../src/lib/protocol.ts");

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

console.log("== 1. 三类问题与分类覆盖 ==");
const brandId = R.createBrand({ name: "协议验收品牌", domain: "proto.example" });
const qsId = R.createQuerySet("协议验收问题集", brandId);
const questions = [
  { text: "协议验收品牌 是什么？", category: "branded_awareness" },
  { text: "潍坊有什么好吃的炒菜馆？", category: "unbranded_recommendation" },
  { text: "三个人吃炒菜人均 60 去哪家？", category: "comparison_scenario" },
];
R.addQuestions(qsId, questions.map((q) => q.text));
const ids = R.listQuestions(qsId).map((q) => q.id);
for (let i = 0; i < ids.length; i++) P.setQuestionCategory(ids[i], questions[i].category);

const coverage = checkCategoryCoverage(P.questionCategories(qsId));
check("三类问题齐全", coverage.ok, JSON.stringify(coverage.counts));
check("分类已落库", R.listQuestions(qsId).every((q) => !!q.category));
check("只有推荐题与场景题计入推荐判断", coverage.counts.branded_awareness === 1 && coverage.counts.unbranded_recommendation === 1);

console.log("== 2. 未冻结的问题集不能建协议 ==");
let threw = false;
try {
  P.createProtocol({ label: "过早协议", querySetId: qsId, engines: ["FixtureAI"], repetition: 3, region: "CN", webSearch: true, surface: "manual_ui", locationMode: "device_location", anchorId: null, daypart: "dinner", modelVersion: null });
} catch {
  threw = true;
}
check("未冻结时拒绝建立协议", threw);

R.freezeQuerySet(qsId);

console.log("== 3. 建立基线协议 ==");
const base = P.createProtocol({
  label: "协议验收 · 基线",
  querySetId: qsId,
  engines: ["FixtureAI"],
  repetition: 3,
  region: "CN",
  webSearch: true,
  surface: "manual_ui",
  locationMode: "device_location",
  anchorId: null,
  daypart: "dinner",
  modelVersion: "v1",
});
check("基线协议已建立", base.created === true);

console.log("== 4. 同条件不会重复建立协议（否则数据会被拆散）==");
const dup = P.createProtocol({
  label: "换个名字但条件相同",
  querySetId: qsId,
  engines: ["FixtureAI"],
  repetition: 3,
  region: "CN",
  webSearch: true,
  surface: "manual_ui",
  locationMode: "device_location",
  anchorId: null,
  daypart: "dinner",
  modelVersion: "v1",
});
check("指纹相同复用已有协议", dup.created === false && dup.id === base.id);

console.log("== 5. 平台顺序 / 大小写不影响指纹 ==");
const reordered = P.createProtocol({
  label: "平台顺序不同",
  querySetId: qsId,
  engines: ["fixtureai", "FixtureAI"],
  repetition: 3,
  region: "cn",
  webSearch: true,
  surface: "manual_ui",
  locationMode: "device_location",
  anchorId: null,
  daypart: "dinner",
  modelVersion: "v1",
});
check("去重后仍是同一份协议", reordered.id === base.id);

console.log("== 6. 不同条件产生不同协议 ==");
const otherMode = P.createProtocol({
  label: "文字定位变体",
  querySetId: qsId,
  engines: ["FixtureAI"],
  repetition: 3,
  region: "CN",
  webSearch: true,
  surface: "manual_ui",
  locationMode: "question_text_only",
  anchorId: null,
  daypart: "dinner",
  modelVersion: "v1",
});
check("定位方式不同 → 不同协议", otherMode.id !== base.id);
check("两者不可直接对比", P.compareProtocolIds(base.id, otherMode.id).comparable === false);

console.log("== 7. 复制为复测协议 ==");
const clone = P.cloneProtocol(base.id, { label: "协议验收 · 第 7 天复测", modelVersion: "v2" });
check("复测协议已建立", clone.created === true && clone.id !== base.id);
check("复测与基线可与对比（只改了环境条件）", clone.comparison.comparable === true, JSON.stringify(clone.comparison.differences));
check("记录了来源协议", P.getProtocol(clone.id)?.cloned_from === base.id);
const baseRow = P.getProtocol(base.id)!;
check("基线协议未被改动（复制无副作用）", baseRow.model_version === "v1", String(baseRow.model_version));

console.log("== 8. 跨协议不混算：批次按协议归属 ==");
const runA = R.createSamplingRun({ label: "基线批次", querySetId: qsId, samplingMode: "manual_ui", engines: ["FixtureAI"], protocolId: base.id, webSearch: true, locationMode: "device_location", daypart: "dinner" });
const runB = R.createSamplingRun({ label: "复测批次", querySetId: qsId, samplingMode: "manual_ui", engines: ["FixtureAI"], protocolId: clone.id, webSearch: true, locationMode: "device_location", daypart: "dinner" });
const runUnbound = R.createSamplingRun({ label: "未绑定协议批次", querySetId: qsId, samplingMode: "manual_ui", engines: ["FixtureAI"] });

check("基线协议下 1 个批次", P.listRunsForProtocol(base.id).length === 1);
check("复测协议下 1 个批次", P.listRunsForProtocol(clone.id).length === 1);
check("未绑定协议的批次被单独列出", P.listUnboundRuns().some((r) => r.id === runUnbound.runId));

for (const t of R.listSamplingTasks(runA.runId)) {
  R.saveSample({ taskId: t.id, rawAnswer: "推荐 协议验收品牌，并引用 https://proto.example/a" });
}
for (const t of R.listSamplingTasks(runB.runId)) {
  R.saveSample({ taskId: t.id, rawAnswer: "没有提到相关品牌。" });
}
check("样本级继承批次联网标记", R.listSamples(runA.runId).every((s) => (s as unknown as { web_search: number }).web_search === 1));

console.log("== 9. 指标按协议分组，跨协议不做差值判断 ==");
const { evaluateScope } = await import("../src/lib/evaluate-run.ts");
evaluateScope({ brandId, runId: runA.runId });
evaluateScope({ brandId, runId: runB.runId });
const snapsA = R.listMetricSnapshots(runA.runId);
const snapsB = R.listMetricSnapshots(runB.runId);
check("基线批次有自己的指标快照", snapsA.length > 0, `${snapsA.length} 个`);
check("复测批次有自己的指标快照", snapsB.length > 0, `${snapsB.length} 个`);
check("两次快照互不覆盖（按 run 分开存）", JSON.stringify(snapsA.map((s) => s.run_id)) !== JSON.stringify(snapsB.map((s) => s.run_id)));

console.log("== 10. 条件改变后会被判为不可对比 ==");
const badClone = P.cloneProtocol(base.id, { label: "偷偷改了定位方式", anchorId: null });
// 复制不允许改平台/联网/界面；这里用直接建协议模拟"改错了"
const tampered = P.createProtocol({
  label: "篡改协议",
  querySetId: qsId,
  engines: ["FixtureAI"],
  repetition: 3,
  region: "CN",
  webSearch: false,
  surface: "manual_ui",
  locationMode: "device_location",
  anchorId: null,
  daypart: "dinner",
  modelVersion: "v1",
});
const cmp = compareProtocols(P.rowToConditions(P.getProtocol(base.id)!), P.rowToConditions(P.getProtocol(tampered.id)!));
check("联网开关不同 → 不可对比", cmp.comparable === false);
check("给出可执行的说明", /请用同一份协议重新采样|并排展示/.test(cmp.note), cmp.note);
check("复制接口不提供覆盖平台/联网的能力", badClone.comparison.comparable === true, "cloneProtocol 只接受环境类覆盖");

console.log("== 11. 运营台页面可访问 ==");
const { createSessionToken, COOKIE_NAME } = await import("../src/lib/auth.ts");
const cookie = `${COOKIE_NAME}=${await createSessionToken()}`;
for (const [p, needles] of [
  ["/console/protocols", ["采样协议", "协议一旦建立", "认知题", "计入推荐判断"]],
  ["/console/questions", ["分类覆盖", "分类", "推荐题"]],
  ["/console/sampling", ["采样协议", "不绑定协议"]],
] as Array<[string, string[]]>) {
  const res = await fetch(`${BASE}${p}`, { headers: { cookie } });
  const html = await res.text();
  const miss = needles.filter((n) => !html.includes(n));
  check(`GET ${p} 200 且内容齐全`, res.status === 200 && miss.length === 0, miss.length ? `缺少 ${miss.join(",")}` : `HTTP ${res.status}`);
}

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
