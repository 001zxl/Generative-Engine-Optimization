/**
 * 真实工厂站试点：把七步链路跑到「待人工采样」为止。
 *
 * 目标站点：派联铝业 www.pailian-aluminium.com（真实中国铝型材出口厂英文站）
 * 数据来源：真实抓取的页面内容，事实条目均带可核验的原始 URL。
 *
 * ⚠️ 第 4 步（采样）只生成任务，不填充回答。原因：
 *   1. 消费端 AI 界面（ChatGPT / 豆包 / 千问）需要登录会话，本机无法访问；
 *   2. 用 API 补全产生的回答**不含检索与引用**，用它算 GEO 指标没有意义。
 *   真实回答必须由人在真实界面取得后粘贴 —— 这是唯一正确的方法。
 *
 * 运行：node scripts/pilot-real-site.ts
 */
import fs from "node:fs";
import * as R from "../src/lib/db/repo-domains.ts";

const SITE = "https://www.pailian-aluminium.com";

/* =====================================================================
 * 第 1 步：品牌与竞品（真实实体）
 * ===================================================================== */
const brandId = R.createBrand({
  name: "Pailian Aluminium",
  domain: "pailian-aluminium.com",
  description: "中国铝型材挤压与 CNC 加工出口厂，面向海外中小品牌，支持低起订量定制",
});
for (const a of [
  "Pailian",
  "Pailian Aluminium Profile Company Ltd",
  "派联铝业",
  "Pailian Aluminum",
]) {
  R.addAlias(brandId, a, a.includes("派联") ? "former_name" : "alias");
}
// 竞品取自同一次真实检索到的同类中国出口厂
R.addCompetitor(brandId, "HXM Aluminum", "hxm-aluminum.com");

/* =====================================================================
 * 第 2 步：问题库（真实海外买家决策期问题）
 * ===================================================================== */
const qsId = R.createQuerySet("Pailian · 海外买家监测集 V1", brandId);

const QUESTIONS: Array<{ text: string; intent: string; stage: string; locale: string }> = [
  {
    text: "Which Chinese aluminum profile manufacturers can handle a 500-unit trial order?",
    intent: "比较",
    stage: "中期",
    locale: "en",
  },
  {
    text: "Who are the reliable aluminum extrusion suppliers in China for small MOQ orders?",
    intent: "比较",
    stage: "中期",
    locale: "en",
  },
  {
    text: "What is a typical MOQ for custom aluminum extrusion from Chinese factories?",
    intent: "认知",
    stage: "早期",
    locale: "en",
  },
  {
    text: "Which Chinese suppliers offer both aluminum extrusion and CNC machining in one place?",
    intent: "比较",
    stage: "中期",
    locale: "en",
  },
  {
    text: "How do I verify that a Chinese aluminum profile factory is ISO 9001 certified?",
    intent: "风险",
    stage: "后期",
    locale: "en",
  },
  {
    text: "What certifications should I check before ordering aluminum profiles from China?",
    intent: "风险",
    stage: "后期",
    locale: "en",
  },
  {
    text: "Which Chinese aluminum profile suppliers serve small and medium brands in Europe?",
    intent: "比较",
    stage: "中期",
    locale: "en",
  },
  {
    text: "How long does custom aluminum extrusion tooling take from a Chinese supplier?",
    intent: "操作",
    stage: "中期",
    locale: "en",
  },
  {
    text: "Who can supply anodized and wood-grain aluminum profiles with a low minimum order?",
    intent: "比较",
    stage: "中期",
    locale: "en",
  },
  {
    text: "铝型材厂的最小起订量一般是多少？交期多久？",
    intent: "认知",
    stage: "早期",
    locale: "zh-CN",
  },
];

const added = R.addQuestions(
  qsId,
  QUESTIONS.map((q) => q.text),
);
console.log(`  问题：新增 ${added.added} 条（跳过重复 ${added.skippedDuplicate}）`);

// 逐条补上意图/阶段/语言（addQuestions 支持批量 meta，这里按条精确设置）
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
console.log(`  冻结：${frozen.ok ? "成功" : "失败 - " + frozen.reason}`);

/* =====================================================================
 * 第 3 步：事实与证据（全部来自真实页面，带原始 URL）
 * ===================================================================== */
const FACTS: Array<{
  key: string;
  statement: string;
  category: string;
  evidenceTitle: string;
  evidenceUrl: string;
  level: string;
}> = [
  {
    key: "moq",
    statement: "标准铝型材 500 件起订，试单可接受更低起订量，样品免费提供",
    category: "交付",
    evidenceTitle: "官网首页：MOQ Low, flexible / Samples Free samples available",
    evidenceUrl: `${SITE}/`,
    level: "self",
  },
  {
    key: "lead_time",
    statement: "标准型材交期 7–10 天，定制开模 15–20 天",
    category: "交付",
    evidenceTitle: "官网产品页 Q&A：Q: How long is delivery?",
    evidenceUrl: `${SITE}/aluminium-extrusion-profiles/aluminum-profile-supplier-in-china.html`,
    level: "self",
  },
  {
    key: "capacity_base",
    statement: "拥有 100,000 平方米生产基地与 25 条自动化挤压生产线",
    category: "产能",
    evidenceTitle: "官网产品页：Real factory with 100,000 ㎡ production base / 25 automatic extrusion lines",
    evidenceUrl: `${SITE}/aluminium-extrusion-profiles/aluminum-profile-supplier-in-china.html`,
    level: "self",
  },
  {
    key: "cnc_workshop",
    statement: "配备 5,000 平方米 CNC 加工车间",
    category: "产能",
    evidenceTitle: "官网产品页：5,000 ㎡ CNC workshop",
    evidenceUrl: `${SITE}/aluminium-extrusion-profiles/aluminum-profile-supplier-in-china.html`,
    level: "self",
  },
  {
    key: "certifications",
    statement: "通过 ISO 9001、ISO 14001、CE、SGS、RoHS、TUV 认证",
    category: "资质",
    evidenceTitle: "官网：已通过 ISO9001、ISO14001、CE、SGS、ROHS、TUV 等认证",
    evidenceUrl: `${SITE}/`,
    level: "self",
  },
  {
    key: "standard",
    statement: "执行 GB5237-2017 国家标准",
    category: "资质",
    evidenceTitle: "官网：implement the national GB5237-2017 standard",
    evidenceUrl: `${SITE}/`,
    level: "self",
  },
  {
    key: "export_coverage",
    statement: "产品出口到 80 多个国家",
    category: "服务",
    evidenceTitle: "官网：clients in over 80 countries",
    evidenceUrl: `${SITE}/`,
    level: "self",
  },
  {
    key: "quotation_sla",
    statement: "24 小时内提供报价",
    category: "服务",
    evidenceTitle: "官网：Fast quotation within 24 hours",
    evidenceUrl: `${SITE}/`,
    level: "self",
  },
  {
    key: "capability",
    statement: "提供挤压、表面处理、CNC 加工、组装与全球发货的一站式服务",
    category: "服务",
    evidenceTitle: "官网：extrusion, surface treatment, CNC machining, assembly, and global delivery",
    evidenceUrl: `${SITE}/`,
    level: "self",
  },
];

let cid = 0;
for (const f of FACTS) {
  const id = R.createClaim({
    claimKey: f.key,
    statement: f.statement,
    category: f.category,
  });
  R.addEvidence({
    claimId: id,
    title: f.evidenceTitle,
    url: f.evidenceUrl,
    publisher: "Pailian Aluminium 官网",
    // 全部是「自述」级 —— 这是我们自己的官网说法，不是第三方佐证。
    // 如实标注等级，客户才能判断可信度。
    evidenceLevel: f.level,
  });
  R.reviewClaim(id, "approved");
  cid++;
}
console.log(`  事实：${cid} 条已批准（全部为「自述」级，来源为官网）`);

/* =====================================================================
 * 第 4 步：采样批次（只生成任务，回答待人工粘贴）
 * ===================================================================== */
const run = R.createSamplingRun({
  label: "Pailian · 2026-09 基线（真实站点试点）",
  querySetId: qsId,
  samplingMode: "manual_ui",
  engines: ["ChatGPT", "通义千问"],
  region: "DE",
  repetition: 1,
});
console.log(`  采样任务：${run.tasks} 个（${QUESTIONS.length} 问 × 2 引擎）`);

/* =====================================================================
 * 输出：给人工采样用的清单
 * ===================================================================== */
const tasks = R.listSamplingTasks(run.runId);
console.log("\n" + "=".repeat(72));
console.log("待人工采样清单（在真实消费端界面提问，把完整回答复制回来）");
console.log("=".repeat(72));
for (const engine of ["ChatGPT", "通义千问"]) {
  console.log(`\n【${engine}】`);
  let i = 0;
  for (const t of tasks.filter((x) => x.engine === engine)) {
    i++;
    console.log(`  ${String(i).padStart(2)}. ${t.question_text}`);
  }
}
console.log("\n" + "=".repeat(72));
console.log("录入地址：http://localhost:3100/console/sampling?run=" + run.runId);
console.log("=".repeat(72));

fs.writeFileSync("/tmp/pilot-run-id.txt", run.runId);
