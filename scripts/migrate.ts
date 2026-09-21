/**
 * 显式执行数据库迁移。
 *
 * 为什么需要显式步骤：迁移挂在 `getDb()` 的懒加载里，
 * 意味着它会在"第一个访问数据库的请求"时才执行 —— 部署时时机不确定，
 * 而且如果启动后没人访问，迁移就一直没跑。
 *
 * 部署顺序应为：
 *   pnpm install && pnpm migrate && pnpm build && pnpm start
 *
 * 保留懒加载作为兜底（忘了跑这一步也不会崩），但不要依赖它。
 */
import { getDb } from "../src/lib/db/index.ts";
import { runColumnMigrations, COLUMN_MIGRATIONS } from "../src/lib/db/migrate.ts";

const db = getDb();
const before = COLUMN_MIGRATIONS.length;
const out = runColumnMigrations(db);

console.log("[migrate] 列迁移检查完成");
console.log(`  已应用: ${out.applied.length ? out.applied.join(", ") : "（无需变更）"}`);
console.log(`  已存在: ${out.skipped.length} / ${before}`);
if (out.failed.length) {
  console.error(`  ✖ 失败 ${out.failed.length} 项：`);
  for (const f of out.failed) console.error(`     ${f.target}: ${f.error}`);
  process.exit(1);
}
