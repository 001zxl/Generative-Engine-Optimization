/**
 * 为「评估页 P0 缺陷」的浏览器级回归测试准备夹具库。
 *
 * 这里的回答是**明确标注的测试夹具**，不是真实 AI 平台回答 ——
 * 只用于验证评估接口在「跨批次范围」下不再触发外键错误。
 * 真实试点数据在 data/geo.db，不受影响。
 *
 * 运行：node scripts/fixture-for-eval-test.ts <DB_PATH>
 */
import path from "node:path";

const DB = process.argv[2];
if (!DB) {
  console.error("用法：node scripts/fixture-for-eval-test.ts <DB_PATH>");
  process.exit(1);
}

const resolved = path.resolve(DB);
const pilot = path.join(process.cwd(), "data", "geo.db");

// 必须在 import 数据库模块**之前**设好，因为连接是懒加载但只建一次，
// 之后再改 process.env.DATABASE_PATH 不会生效 —— 这正是本脚本曾经的缺陷：
// 它接受了 DB_PATH 参数却从未使用，静默把夹具写进了试点库 data/geo.db。
if (resolved === pilot) {
  console.error(`拒绝在试点库上运行夹具：${resolved}。请传入临时路径，例如 /tmp/fx.db`);
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;

// 动态 import：确保上面的环境变量先生效
const R = await import("../src/lib/db/repo-domains.ts");

const brandId = R.createBrand({ name: "Fixture Brand", domain: "fixture.example", description: "测试夹具" });
R.addAlias(brandId, "Fixture");
R.addCompetitor(brandId, "Rival Co", "rival.example");

const qsId = R.createQuerySet("Fixture 问题集", brandId);
R.addQuestions(qsId, ["Fixture question one?", "Fixture question two?"]);
R.freezeQuerySet(qsId);

const run = R.createSamplingRun({
  label: "Fixture 批次",
  querySetId: qsId,
  samplingMode: "manual_ui",
  engines: ["FixtureEngine"],
  region: "XX",
  repetition: 1,
});

// 夹具回答：带引用 URL，便于同时验证引用抽取
const ANSWERS = [
  "1. Rival Co — large scale\n2. Fixture Brand — small batches, MOQ 500 件起订\n\nSource: https://fixture.example/moq",
  "Fixture Brand is mentioned here without any citation.",
];
const tasks = R.listSamplingTasks(run.runId);
tasks.forEach((t, i) => {
  R.saveSample({ taskId: t.id, rawAnswer: ANSWERS[i % ANSWERS.length] });
});

console.log(`fixture ready: db=${resolved} run=${run.runId} samples=${tasks.length}`);
