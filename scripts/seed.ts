/**
 * 演示数据种子。
 *
 * 为什么需要它：源码 clone 下来后运营台是空的（brands=0、questions=0），
 * 七个模块看起来像"没做完"。这个脚本把一份**真实站点的试点数据**写进去，
 * 让任何人 clone 后能立刻看到完整链路长什么样。
 *
 * 数据来源：真实抓取 pailian-aluminium.com 的公开页面内容。
 * 不包含任何线索邮箱、客户联系人或本机配置。
 *
 * 幂等：已存在同名品牌时直接跳过，不会重复写入。
 *
 * 运行：
 *   pnpm seed                      # 写入 data/geo.db
 *   DATABASE_PATH=/tmp/x.db pnpm seed   # 写入指定库
 */
import fs from "node:fs";
import * as R from "../src/lib/db/repo-domains.ts";

const SITE = "https://www.pailian-aluminium.com";
const BRAND_NAME = "Pailian Aluminium";

/* ------------------------------------------------------------------ */
function alreadySeeded(): boolean {
  return R.listBrands().some((b) => b.name === BRAND_NAME);
}

if (alreadySeeded()) {
  console.log(`[seed] 已存在品牌「${BRAND_NAME}」，跳过。要重新播种请先 pnpm db:reset。`);
  process.exit(0);
}

console.log("[seed] 写入演示数据（真实工厂站：pailian-aluminium.com）\n");

/* ============ 模块 1：品牌与竞品 ============ */
const brandId = R.createBrand({
  name: BRAND_NAME,
  domain: "pailian-aluminium.com",
  description: "中国铝型材挤压与 CNC 加工出口厂，面向海外中小品牌，支持低起订量定制",
});
for (const a of ["Pailian", "Pailian Aluminium Profile Company Ltd", "Pailian Aluminum", "派联铝业"]) {
  R.addAlias(brandId, a, a.includes("派联") ? "former_name" : "alias");
}
R.addCompetitor(brandId, "HXM Aluminum", "hxm-aluminum.com");
console.log("  模块1 品牌与竞品      1 品牌 / 4 别名 / 1 竞品");

/* ============ 模块 2：问题库 ============ */
const qsId = R.createQuerySet("Pailian · 海外买家监测集 V1", brandId);

const QUESTIONS: Array<{ text: string; intent: string; stage: string; locale: string }> = [
  { text: "Which Chinese aluminum profile manufacturers can handle a 500-unit trial order?", intent: "比较", stage: "中期", locale: "en" },
  { text: "Who are the reliable aluminum extrusion suppliers in China for small MOQ orders?", intent: "比较", stage: "中期", locale: "en" },
  { text: "What is a typical MOQ for custom aluminum extrusion from Chinese factories?", intent: "认知", stage: "早期", locale: "en" },
  { text: "Which Chinese suppliers offer both aluminum extrusion and CNC machining in one place?", intent: "比较", stage: "中期", locale: "en" },
  { text: "How do I verify that a Chinese aluminum profile factory is ISO 9001 certified?", intent: "风险", stage: "后期", locale: "en" },
  { text: "What certifications should I check before ordering aluminum profiles from China?", intent: "风险", stage: "后期", locale: "en" },
  { text: "Which Chinese aluminum profile suppliers serve small and medium brands in Europe?", intent: "比较", stage: "中期", locale: "en" },
  { text: "How long does custom aluminum extrusion tooling take from a Chinese supplier?", intent: "操作", stage: "中期", locale: "en" },
  { text: "Who can supply anodized and wood-grain aluminum profiles with a low minimum order?", intent: "比较", stage: "中期", locale: "en" },
  { text: "铝型材厂的最小起订量一般是多少？交期多久？", intent: "认知", stage: "早期", locale: "zh-CN" },
];

R.addQuestions(qsId, QUESTIONS.map((q) => q.text));
{
  const { getDb } = await import("../src/lib/db/index.ts");
  const db = getDb();
  for (const q of QUESTIONS) {
    db.prepare("UPDATE questions SET intent = ?, funnel_stage = ?, locale = ? WHERE query_set_id = ? AND text = ?").run(
      q.intent,
      q.stage,
      q.locale,
      qsId,
      q.text,
    );
  }
}
const frozen = R.freezeQuerySet(qsId);
console.log(`  模块2 问题库          1 问题集（v1，${frozen.ok ? "已冻结" : "冻结失败"}）/ ${QUESTIONS.length} 条问题`);

/* ============ 模块 3：事实与证据 ============ */
const FACTS = [
  { key: "moq", statement: "标准铝型材 500 件起订，试单可接受更低起订量，样品免费提供", category: "交付", title: "官网首页：MOQ Low, flexible / Free samples available", url: `${SITE}/` },
  { key: "lead_time", statement: "标准型材交期 7–10 天，定制开模 15–20 天", category: "交付", title: "官网产品页 Q&A：Q: How long is delivery?", url: `${SITE}/aluminium-extrusion-profiles/aluminum-profile-supplier-in-china.html` },
  { key: "capacity_base", statement: "拥有 100,000 平方米生产基地与 25 条自动化挤压生产线", category: "产能", title: "官网产品页：100,000 ㎡ production base / 25 automatic extrusion lines", url: `${SITE}/aluminium-extrusion-profiles/aluminum-profile-supplier-in-china.html` },
  { key: "cnc_workshop", statement: "配备 5,000 平方米 CNC 加工车间", category: "产能", title: "官网产品页：5,000 ㎡ CNC workshop", url: `${SITE}/aluminium-extrusion-profiles/aluminum-profile-supplier-in-china.html` },
  { key: "certifications", statement: "通过 ISO 9001、ISO 14001、CE、SGS、RoHS、TUV 认证", category: "资质", title: "官网：已通过 ISO9001、ISO14001、CE、SGS、ROHS、TUV 等认证", url: `${SITE}/` },
  { key: "standard", statement: "执行 GB5237-2017 国家标准", category: "资质", title: "官网：implement the national GB5237-2017 standard", url: `${SITE}/` },
  { key: "export_coverage", statement: "产品出口到 80 多个国家", category: "服务", title: "官网：clients in over 80 countries", url: `${SITE}/` },
  { key: "quotation_sla", statement: "24 小时内提供报价", category: "服务", title: "官网：Fast quotation within 24 hours", url: `${SITE}/` },
  { key: "capability", statement: "提供挤压、表面处理、CNC 加工、组装与全球发货的一站式服务", category: "服务", title: "官网：extrusion, surface treatment, CNC machining, assembly, and global delivery", url: `${SITE}/` },
];

for (const f of FACTS) {
  const id = R.createClaim({ claimKey: f.key, statement: f.statement, category: f.category });
  // 全部标为「自述」级：这是我们自己官网的说法，不是第三方佐证。
  // 如实标注等级，客户才能判断该信多少。
  R.addEvidence({ claimId: id, title: f.title, url: f.url, publisher: "Pailian Aluminium 官网", evidenceLevel: "self" });
  R.reviewClaim(id, "approved");
}
console.log(`  模块3 事实与证据      ${FACTS.length} 条已批准（全部「自述」级，带原始 URL）`);

/* ============ 模块 4：采样批次（只生成任务） ============ */
const run = R.createSamplingRun({
  label: "Pailian · 演示基线批次",
  querySetId: qsId,
  samplingMode: "manual_ui",
  engines: ["ChatGPT", "通义千问"],
  region: "DE",
  repetition: 1,
});
console.log(`  模块4 多平台采样      1 批次 / ${run.tasks} 个待采任务（10 问 × 2 引擎）`);

console.log(`
[seed] 完成。

  ⚠️ 模块 5/6/7 为什么还是空的：
     评估需要真实回答，而回答必须由人在真实 AI 界面取得后粘贴 ——
     用 API 补全产生的回答不含检索与引用，算出来的 GEO 指标没有意义。

  下一步：
     1. 打开 http://localhost:3100/console/sampling?run=${run.runId}
     2. 在 ChatGPT / 通义千问 里逐条提问，把**完整回答（含引用来源）**粘回去
     3. 到 /console/evaluation 点「运行评估」，四个指标就会出现

  数据来源：${SITE}（公开页面内容，不含任何线索或联系人信息）
`);

fs.writeFileSync("/tmp/geo-seed-run-id.txt", run.runId);
