/**
 * 启动前配置守卫（preflight）。
 *
 * 为什么需要它：默认配置里带着 http://localhost:3100 与 hello@example.com。
 * 这类占位值一旦被带上生产环境，会直接产生三个真实后果：
 *   1. canonical / OpenGraph / sitemap 全部指向 localhost —— 等于告诉搜索引擎和
 *      AI 爬虫"这个站点的规范地址是本机"，收录与引用会全面错乱；
 *   2. 页面上的联系方式是假邮箱，客户咨询直接丢失；
 *   3. 站点看起来像未完成的模板，可信度归零 —— 而这恰恰是本产品唯一的卖点。
 *
 * 所以这里不是"打个警告"，而是**拒绝启动**。
 *
 * 本地以生产模式自测时（pnpm build && pnpm start），在 .env 里加：
 *   ALLOW_INSECURE_DEFAULTS=1
 *
 * 判定逻辑在 src/lib/config-guard.ts（纯函数，有单测覆盖）。
 */
import fs from "node:fs";
import path from "node:path";
import { validateConfig, type ConfigPhase } from "../src/lib/config-guard.ts";

/**
 * 阶段参数：
 *   build   —— 只查会被固化进构建产物的公开配置（APP_BASE_URL / SITE_NAME / CONTACT_EMAIL）
 *   runtime —— 只查密钥与数据路径（CONSOLE_PASSWORD / AUTH_SECRET / DATABASE_PATH）
 *   省略     —— 两者都查（本地 pnpm start 与 pnpm build 用这个）
 *
 * 为什么必须分开：密钥一旦出现在构建环境，就会被写进镜像层 ——
 * 任何拿到镜像的人都能从历史层里读出运营台口令。
 */
const phaseArg = process.argv[2];
if (phaseArg && !["build", "runtime", "all"].includes(phaseArg)) {
  console.error(`[preflight] 未知阶段：${phaseArg}（可选 build / runtime / all）`);
  process.exit(2);
}
const phase = (phaseArg ?? "all") as ConfigPhase;

/** 极简 .env 解析：本脚本在 next 之前运行，所以自己读一份 */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 部署平台注入的真实环境变量优先于 .env 文件
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const root = process.cwd();
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

const verdict = validateConfig(process.env as Record<string, string | undefined>, phase);

if (phase === "build") {
  console.log("[preflight] 阶段：构建期（仅校验公开配置；密钥不参与构建）");
} else if (phase === "runtime") {
  console.log("[preflight] 阶段：运行期（校验密钥与数据路径）");
}
if (verdict.bypassed) {
  console.warn(
    "[preflight] ⚠️ ALLOW_INSECURE_DEFAULTS=1：已跳过占位配置校验。" +
      "该开关仅供本地以生产模式自测使用，正式部署务必移除。",
  );
}
for (const w of verdict.warnings) console.warn(`[preflight] ⚠️  ${w}`);

if (verdict.errors.length > 0 && !verdict.bypassed) {
  console.error(`\n[preflight] ✖ 拒绝启动（阶段：${phase}）：检测到不适用于生产环境的配置\n`);
  for (const e of verdict.errors) console.error(`  • ${e}`);
  console.error(
    "\n  修正方式：在部署环境设置真实值（或在 .env 中填写）。参考 .env.example。\n" +
      "  本地以生产模式自测：在 .env 中加一行 ALLOW_INSECURE_DEFAULTS=1\n" +
      `  当前 NODE_ENV=${process.env.NODE_ENV ?? "production"}，项目目录：${root}\n`,
  );
  process.exit(1);
}

console.log("[preflight] ✓ 配置校验通过");
