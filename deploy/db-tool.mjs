/**
 * 备份 / 校验 / 恢复核对用的小工具。
 *
 * 独立成文件而不是塞进 shell 的 `node -e`：SQL 字符串字面量需要单引号，
 * 和 shell 的单引号会互相截断，那种转义写法的可读性和可靠性都很差。
 *
 * 子命令：
 *   vacuum <src> <dst>   一致性副本（VACUUM INTO），可在应用写入时执行
 *   verify <db> [--full] 打开副本并校验：表数量、工作区、外键、完整性
 */
import { DatabaseSync } from "node:sqlite";

const [cmd, ...args] = process.argv.slice(2);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function open(path, readOnly = true) {
  if (!path) fail("缺少数据库路径");
  try {
    return new DatabaseSync(path, { readOnly });
  } catch (e) {
    fail(`无法打开数据库 ${path}：${e.message}`);
  }
}

if (cmd === "vacuum") {
  const [src, dst] = args;
  if (!dst) fail("用法：db-tool.mjs vacuum <src> <dst>");
  const db = open(src);
  // VACUUM INTO 生成一致快照，不需要停服；直接 cp 会拿到撕裂的页
  db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
  db.close();
  console.log(`[db-tool] 已生成一致性副本：${dst}`);
} else if (cmd === "verify") {
  const [path, mode] = args;
  const db = open(path);
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
  const objectValues = (row) => Object.values(row);
  const integrity = objectValues(db.prepare("PRAGMA integrity_check").get())[0];
  const fk = db.prepare("PRAGMA foreign_key_check").all();

  if (mode === "--full") {
    if (integrity !== "ok") fail(`[db-tool] integrity_check 未通过：${integrity}`);
    if (fk.length > 0) fail(`[db-tool] 外键孤儿：${JSON.stringify(fk.slice(0, 5))}`);
  }
  if (tables < 10) fail(`[db-tool] 表数量异常（${tables}）—— 副本可能不完整`);

  let workspaces = null;
  try {
    workspaces = db.prepare("SELECT COUNT(*) AS n FROM workspaces").get().n;
  } catch {
    fail("[db-tool] 副本里没有 workspaces 表，不是本应用的数据库");
  }
  if (workspaces < 1) fail("[db-tool] 副本里没有工作区，备份不完整");

  console.log(`[db-tool] integrity_check=${integrity}，外键孤儿 ${fk.length} 条，${tables} 张表，${workspaces} 个工作区`);
  for (const t of ["brands", "stores", "claims", "leads", "public_pages", "sampling_runs", "response_samples"]) {
    try {
      console.log(`           ${t} = ${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`);
    } catch {
      console.log(`           ${t} = （该表不存在）`);
    }
  }
  db.close();
} else {
  fail("用法：db-tool.mjs <vacuum|verify> ...");
}
