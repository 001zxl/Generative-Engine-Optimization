/**
 * A4 验收：发布后六项门槛分开记录，四项状态分开呈现。
 *
 * 只跑在临时库上。用法：
 *   APP_BASE_URL=<夹具服务> node --experimental-strip-types scripts/e2e-publish-gates.ts <DB_PATH> <BASE_URL>
 *
 * 关键点：门槛检查会真实抓取 BASE_URL 上的已发布页面。默认 SSRF 防护拒绝
 * 抓取本机地址，因此本脚本要求：
 *   - 夹具服务与 APP_BASE_URL 指向同一实例（用 127.0.0.1 而不是 localhost，
 *     因为按主机名的本机判定与按 IP 的网段判定是两条路径）
 *   - 脚本进程设置 EXTRA_TRUSTED_CIDRS=127.0.0.1/32 打开逃生口
 * 否则六项门槛会全部标为「未检查」（这是正确行为，但不是本脚本要验的东西）。
 */
import path from "node:path";

const [DB, BASE] = process.argv.slice(2);
if (!DB || !BASE) {
  console.error("用法：node scripts/e2e-publish-gates.ts <DB_PATH> <BASE_URL>");
  process.exit(1);
}
const resolved = path.resolve(DB);
if (resolved === path.join(process.cwd(), "data", "geo.db")) {
  console.error("拒绝在试点库上运行。");
  process.exit(1);
}
if (!process.env.EXTRA_TRUSTED_CIDRS) {
  console.error("缺少 EXTRA_TRUSTED_CIDRS（例如 127.0.0.1/32）：否则门槛检查会因 SSRF 防护全部标为未检查。");
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;
// 门槛检查要抓的就是夹具服务上的页面
process.env.APP_BASE_URL = BASE;

const R = await import("../src/lib/db/repo-domains.ts");
const P = await import("../src/lib/publishing.ts");
const { parseRobots, isAllowed } = await import("../src/lib/net/robots.ts");
const robotsCfg = await import("../src/lib/robots-config.ts");

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

console.log("== 1. robots.txt：具名爬虫组不得放开运营台/API/结果页 ==");
const robotsRes = await fetch(`${BASE}/robots.txt`);
const robotsText = await robotsRes.text();
check("robots.txt 可获取", robotsRes.status === 200, `HTTP ${robotsRes.status}`);
const parsed = parseRobots(robotsText);
for (const agent of robotsCfg.allRobotsAgents()) {
  for (const p of ["/console", "/console/leads", "/api/leads", "/r/abc"]) {
    const v = isAllowed(parsed, agent, p);
    check(`${agent} 不得抓取 ${p}`, v.allowed === false, v.allowed ? v.reason : "");
  }
}
for (const p of ["/", "/tools/ai-crawler-check", "/knowledge/x", "/stores/x", "/brands/y"]) {
  check(`公开页 ${p} 仍对 Googlebot 放行`, isAllowed(parsed, "Googlebot", p).allowed === true);
}

console.log("== 2. 发布一篇真实内容 ==");
const brandId = R.createBrand({ name: "验收品牌", domain: "gate.example", description: "A4 验收" });
const claimId = R.createClaim({ claimKey: "k1", statement: "月产能 200 吨", brandId });
R.addEvidence({ claimId, kind: "website", title: "产能说明", url: "https://gate.example/capacity", evidenceLevel: "official" });
R.reviewClaim(claimId, "approved");
const assetId = R.createAsset({
  kind: "article",
  title: "A4 门槛验收文章",
  bodyMd: "## 结论\n这是一篇用于验证发布门槛的文章。\n\n## 说明\n内容足够长以便通过正文可读检查。\n\n## 来源\n- [产能说明](https://gate.example/capacity)",
  claimIds: [claimId],
});
R.reviewAsset(assetId, "approved");
const dispatchId = P.createPublicationDispatch(assetId, "own_site");
const exec = await P.executePublicationDispatch(dispatchId);
check("发布成功", exec.status === "succeeded", `${exec.status} ${exec.published_url ?? ""}`);

console.log("== 3. 六项门槛分开记录 ==");
const readiness = await P.checkPublishReadiness(exec.published_url!);
const ids = readiness.gates.map((g) => g.id);
for (const id of ["http", "readable", "canonical", "robots", "sitemap", "structuredData"]) {
  check(`门槛含 ${id}`, ids.includes(id as never), `实际：${ids.join(",")}`);
}
check("门槛检查带时间", !!readiness.checkedAt);
check("分层判定齐全", typeof readiness.reachable === "boolean" && typeof readiness.discoverable === "boolean" && typeof readiness.wellFormed === "boolean");
const byId = Object.fromEntries(readiness.gates.map((g) => [g.id, g]));
check("HTTP 通过", byId.http.ok === true, byId.http.detail);
check("正文可读通过", byId.readable.ok === true, byId.readable.detail);
check("canonical 通过（知识页声明了 canonical）", byId.canonical.ok === true, byId.canonical.detail);
check("robots 通过", byId.robots.ok === true, byId.robots.detail);
check("sitemap 通过（本站 sitemap 含该文章）", byId.sitemap.ok === true, byId.sitemap.detail);
check("结构化数据通过（文章含 Article JSON-LD）", byId.structuredData.ok === true, byId.structuredData.detail);
check("可达性为真", readiness.reachable === true);
check("全部门槛通过", readiness.ok === true, JSON.stringify(readiness.gates.filter((g) => !g.ok)));

console.log("== 4. 门槛结果落库并带时间 ==");
const checkResult = await P.checkPublicationDispatch(dispatchId);
check("复测执行成功", checkResult.ok === true, checkResult.note);
const checks = P.listPublicationChecks();
check("检查记录已写入", checks.length > 0, `${checks.length} 条`);
const latest = checks[0];
const storedGates = JSON.parse(latest.gates_json) as Array<{ id: string }>;
check("落库的门槛是六项", storedGates.length === 6, storedGates.map((g) => g.id).join(","));

console.log("== 5. 四项状态分开呈现 ==");
const status = P.publicationStatusFor(dispatchId);
check("已发布 = 是", status.published.state === "yes", status.published.evidence);
check("可抓取 = 是", status.crawlable.state === "yes", status.crawlable.evidence);
check("已收录 = 未知（不自行断言）", status.indexed.state === "unknown", status.indexed.evidence);
check("被 AI 引用 = 未知（无采样数据）", status.citedByAi.state === "unknown", status.citedByAi.evidence);
check("四项中不含把推断当事实的 yes", status.indexed.state !== "yes" && status.citedByAi.state !== "yes");
check("hasUnknown 为真", status.hasUnknown === true);

console.log("== 6. 有采样但无引用时不得写成「否」 ==");
const qsId = R.createQuerySet("验收问题集", brandId);
R.addQuestions(qsId, ["验收问题一？", "验收问题二？"]);
R.freezeQuerySet(qsId);
const run = R.createSamplingRun({ label: "验收批次", querySetId: qsId, samplingMode: "manual_ui", engines: ["FixtureAI"] });
for (const t of R.listSamplingTasks(run.runId)) {
  R.saveSample({ taskId: t.id, rawAnswer: "这里提到了别家，并引用了 https://other.example/page" });
}
const { evaluateScope } = await import("../src/lib/evaluate-run.ts");
evaluateScope({ brandId, runId: run.runId });
const status2 = P.publicationStatusFor(dispatchId);
check("有样本后仍为未知（不写成否）", status2.citedByAi.state === "unknown", status2.citedByAi.evidence);
check("说明里给出样本数", /已评测 \d+ 条样本/.test(status2.citedByAi.evidence), status2.citedByAi.evidence);

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
