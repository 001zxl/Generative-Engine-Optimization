/**
 * 数据库备份。
 *
 * 唯一的数据文件是 data/geo.db（SQLite，开了 WAL）。
 * 直接 cp 在 WAL 模式下**不安全** —— 可能漏掉尚未 checkpoint 的事务，
 * 得到一个损坏或过期的副本。这里用 SQLite 官方的 `VACUUM INTO`，
 * 它会生成一个一致的、已整理的快照，运行中执行也安全。
 *
 * 用法：
 *   pnpm backup                          # 备份到 backups/geo-<时间戳>.db
 *   pnpm backup /path/to/dir             # 备份到指定目录
 *   KEEP=30 pnpm backup                  # 只保留最近 30 份
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const src = process.env.DATABASE_PATH ?? "./data/geo.db";
const srcAbs = path.isAbsolute(src) ? src : path.join(process.cwd(), src);

if (!fs.existsSync(srcAbs)) {
  console.error(`✖ 数据库不存在：${srcAbs}`);
  process.exit(1);
}

const outDir = path.resolve(process.argv[2] ?? "backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const dest = path.join(outDir, `geo-${stamp}.db`);

const db = new DatabaseSync(srcAbs);
try {
  // VACUUM INTO 生成一致快照；目标文件必须不存在
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
} catch (e) {
  console.error(`✖ 备份失败：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  db.close();
}

const size = fs.statSync(dest).size;

// 校验：备份文件必须能被打开，且表结构可读
let tableCount = 0;
try {
  const check = new DatabaseSync(dest);
  tableCount = (check.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get() as { n: number }).n;
  check.close();
} catch (e) {
  console.error(`✖ 备份文件无法打开，已删除：${e instanceof Error ? e.message : String(e)}`);
  fs.rmSync(dest, { force: true });
  process.exit(1);
}

console.log(`✓ 备份完成`);
console.log(`  源文件  : ${srcAbs}`);
console.log(`  备份到  : ${dest}`);
console.log(`  大小    : ${(size / 1024).toFixed(1)} KB`);
console.log(`  校验    : 可打开，${tableCount} 张表`);

/* —— 保留策略 —— */
const keep = Number(process.env.KEEP ?? "14");
if (Number.isInteger(keep) && keep > 0) {
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("geo-") && f.endsWith(".db"))
    .sort()
    .reverse();
  for (const old of files.slice(keep)) {
    fs.rmSync(path.join(outDir, old), { force: true });
    console.log(`  已清理旧备份: ${old}`);
  }
  console.log(`  保留最近 ${keep} 份`);
}

console.log(`
提醒：备份只在同一块磁盘上，不能防磁盘损坏。
请把 backups/ 定期同步到异地（对象存储 / 另一台机器）。
恢复方式：停止服务 → 用备份文件替换 data/geo.db → 启动。`);
