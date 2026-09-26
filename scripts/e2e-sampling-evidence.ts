/**
 * B2 验收：真实采样证据链。
 *
 * 只跑在全新临时库上。用法：
 *   AUTH_SECRET=... node --experimental-strip-types scripts/e2e-sampling-evidence.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>
 */
import path from "node:path";

const [DB, BASE, PASSWORD] = process.argv.slice(2);
if (!DB || !BASE || !PASSWORD) {
  console.error("用法：node scripts/e2e-sampling-evidence.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>");
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
const S = await import("../src/lib/sampling.ts");
const { assessEvidence, checkSampleEvidence, EVIDENCE_VERDICT_LABEL } = await import("../src/lib/sample-evidence.ts");

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

/* ---------- 准备 ---------- */
const brandId = R.createBrand({ name: "证据验收品牌", domain: "ev.example" });
const qsId = R.createQuerySet("证据验收问题集", brandId);
R.addQuestions(qsId, ["证据验收品牌 是什么？", "附近有什么好吃的？"]);
R.freezeQuerySet(qsId);
const proto = P.createProtocol({
  label: "证据验收协议",
  querySetId: qsId,
  engines: ["FixtureAI"],
  repetition: 1,
  region: "CN",
  webSearch: true,
  surface: "manual_ui",
  locationMode: "device_location",
  anchorId: null,
  daypart: "dinner",
  modelVersion: null,
});
const run = R.createSamplingRun({
  label: "证据验收批次",
  querySetId: qsId,
  samplingMode: "manual_ui",
  engines: ["FixtureAI"],
  protocolId: proto.id,
  webSearch: true,
  locationMode: "device_location",
  daypart: "dinner",
});

console.log("== 1. 人工采样必须带凭据 ==");
const tasks = R.listSamplingTasks(run.runId);
let threw = false;
try {
  S.saveManualObservation({ taskId: tasks[0].id, answer: "有内容", modelVersion: "v1", collectedAt: "not-a-date" });
} catch {
  threw = true;
}
check("不带时区的采集时间被拒绝", threw);

threw = false;
try {
  S.saveManualObservation({ taskId: tasks[0].id, answer: "有内容", modelVersion: "v1", collectedAt: "2026-09-25T10:00:00Z", sourceUrl: "ftp://bad" });
} catch {
  threw = true;
}
check("非 HTTP(S) 来源被拒绝", threw);

const sampleA = S.saveManualObservation({
  taskId: tasks[0].id,
  answer: "推荐 证据验收品牌。来源：https://ev.example/a",
  modelVersion: "v1.2",
  collectedAt: "2026-09-25T10:00:00Z",
  sourceUrl: "https://chat.example.com/share/1",
  screenshotPath: "/shots/1.png",
  citationUrls: "https://ev.example/a",
  collectedBy: "张三",
});
check("完整凭据的样本已保存", !!sampleA);

const provA = S.getSampleProvenance(sampleA);
check("证据种类为消费者界面人工采样", provA?.evidence_kind === "manual_ui", String(provA?.evidence_kind));
check("记录了采样人员", provA?.collected_by === "张三", String(provA?.collected_by));
check("记录了分享链接", !!provA?.source_url);
check("记录了引用网址", (provA?.citations ?? []).length === 1, JSON.stringify(provA?.citations));

const sampleRowA = getDb().prepare("SELECT screenshot_path FROM response_samples WHERE id = ?").get(sampleA) as { screenshot_path: string | null };
check("记录了截图路径", sampleRowA.screenshot_path === "/shots/1.png", String(sampleRowA.screenshot_path));

console.log("== 2. 样本可追溯到原始回答 ==");
check("按 sampleId 能取回原文", (R.getSample(sampleA)?.raw_answer ?? "").includes("证据验收品牌"));
check("原文与引用一起参与抽取", S.answerForExtraction({ id: sampleA, raw_answer: R.getSample(sampleA)!.raw_answer }).includes("https://ev.example/a"));

console.log("== 3. 同一任务不能重复采集 ==");
const again = S.saveManualObservation({
  taskId: tasks[0].id, answer: "重复提交", modelVersion: "v1", collectedAt: "2026-09-25T11:00:00Z",
});
check("重复采集返回原样本（幂等）", again === sampleA);
const before = (getDb().prepare("SELECT COUNT(*) AS n FROM response_samples").get() as { n: number }).n;
check("没有产生重复样本", before === 1, `${before} 条`);

console.log("== 4. 本平台生成的模拟回答不得入库 ==");
let dbRejected = false;
try {
  getDb().prepare(`INSERT INTO sample_provenance (sample_id,task_id,evidence_kind,model_version,citations_json,request_config_json,recorded_at,payload_json)
    VALUES (?,?,?,?,?,?,?,?)`).run("smp_fake", tasks[1].id, "synthetic", "v1", "[]", "{}", new Date().toISOString(), "{}");
} catch {
  dbRejected = true;
}
check("数据库拒绝写入 synthetic 证据", dbRejected);

console.log("== 5. 官方 API 样本单独成组 ==");
// 直接构造一条 official_api 证据（模拟 Perplexity 采集路径）
const sampleB = R.saveSample({ taskId: tasks[1].id, rawAnswer: "API 回答：未提及该品牌。" }).sampleId;
getDb().prepare(`INSERT INTO sample_provenance (sample_id,task_id,evidence_kind,model_version,citations_json,request_config_json,recorded_at,payload_json)
  VALUES (?,?,?,?,?,?,?,?)`).run(sampleB, tasks[1].id, "official_api", "sonar", "[]", "{}", new Date().toISOString(), "{}");
const provB = S.getSampleProvenance(sampleB);
check("官方 API 证据种类已记录", provB?.evidence_kind === "official_api");

const groups = S.collectSampleEvidence();
check("两种界面被分到不同组", new Set(groups.map((g) => g.surface)).size === 2, JSON.stringify([...new Set(groups.map((g) => g.surface))]));
check("分组带协议与定位方式", groups.every((g) => g.locationMode === "device_location" && g.protocolId === proto.id));

console.log("== 6. 证据不足 → 不可判定 ==");
const assessment = assessEvidence(S.collectSampleEvidence());
check("整体判为不足或不可判定", assessment.verdict !== "sufficient", assessment.verdict);
check("判定文案可展示", !!EVIDENCE_VERDICT_LABEL[assessment.verdict], EVIDENCE_VERDICT_LABEL[assessment.verdict]);
check("说明里给出具体原因", /少于|无法判定|不可判定/.test(assessment.note), assessment.note);
check("官方 API 组因无凭据被降级", assessment.groups.some((g) => g.surface === "official_api" && g.verdict !== "sufficient"));

console.log("== 7. 单条证据检查的具体结论 ==");
const good = checkSampleEvidence({ kind: "manual_ui", rawAnswer: "x", modelVersion: "v1", collectedAt: "t", collectedBy: "张三", shareUrl: "https://x", screenshotPath: null, citationUrls: [] });
check("有链接即可追溯", good.countable && good.traceable);
const noCred = checkSampleEvidence({ kind: "manual_ui", rawAnswer: "x", modelVersion: "v1", collectedAt: "t", collectedBy: null, shareUrl: null, screenshotPath: null, citationUrls: [] });
check("无凭据：可保存但不可追溯", noCred.countable && !noCred.traceable);
check("无凭据时给出 4 条建议", noCred.warnings.length === 4, JSON.stringify(noCred.warnings));
const fixture = checkSampleEvidence({ kind: "fixture", rawAnswer: "x", modelVersion: "v1", collectedAt: "t", collectedBy: "x", shareUrl: "u", screenshotPath: null, citationUrls: [] });
check("夹具数据不可计入", !fixture.countable && fixture.blockers.some((b) => b.includes("不得作为外部平台结果")));

console.log("== 8. 报告页面标记证据判定 ==");
const { createSessionToken, COOKIE_NAME } = await import("../src/lib/auth.ts");
const cookie = `${COOKIE_NAME}=${await createSessionToken()}`;
const storeId = (await import("../src/lib/db/repo-local.ts")).createStore({ name: "证据验收门店", city: "示例市" });
const res = await fetch(`${BASE}/console/geo-report?store=${storeId}`, { headers: { cookie } });
const html = await res.text();
check("报告页 200", res.status === 200, `HTTP ${res.status}`);
check("报告显示证据判定", html.includes("证据判定"));
check("报告显示判定等级", html.includes(EVIDENCE_VERDICT_LABEL[assessment.verdict]), EVIDENCE_VERDICT_LABEL[assessment.verdict]);
check("报告说明分组口径", html.includes("协议 × 界面 × 定位方式 × 联网状态"));
check("报告给出分组明细", html.includes("可信样本"));

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
