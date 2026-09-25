/**
 * 轻量列迁移。
 *
 * 为什么需要它：schema 全部用 `CREATE TABLE IF NOT EXISTS` 定义，
 * 这对**新建**数据库有效，但对**已经存在**的表加不了新列。
 * 给 leads 加 owner / notified_at / notify_error 时就会卡在这里。
 *
 * 这里刻意不引入完整的迁移框架（版本号、up/down、回滚）—— 单机 SQLite、
 * 单人维护，那套东西的复杂度换不来对应的收益。只做两件必要的事：
 *   1. 幂等：重复执行无副作用
 *   2. 可审计：每次实际执行的变更都写进 change_logs
 *
 * 明确的限制（换 PostgreSQL 时必须补上真正的迁移系统）：
 *   - 只支持加列，不支持改类型/删列/数据搬迁
 *   - 没有版本号，靠 PRAGMA 探测现状决定是否执行
 */
import type { DatabaseSync } from "node:sqlite";
import { LOCAL_COLUMN_MIGRATIONS } from "./schema-local.ts";
import { PUBLISH_COLUMN_MIGRATIONS } from "./schema-publishing.ts";
import { PUBLIC_COLUMN_MIGRATIONS } from "./schema-public.ts";

export interface ColumnMigration {
  table: string;
  column: string;
  /** 传给 ALTER TABLE ADD COLUMN 的完整定义（不含逗号） */
  ddl: string;
  note: string;
}

export const COLUMN_MIGRATIONS: ColumnMigration[] = [
  {
    table: "leads",
    column: "owner",
    ddl: "owner TEXT",
    note: "线索跟进责任人 —— 没有责任人的线索等于没人跟进",
  },
  {
    table: "leads",
    column: "notified_at",
    ddl: "notified_at TEXT",
    note: "通知成功的时间；为 NULL 表示尚未成功通知过",
  },
  {
    table: "leads",
    column: "notify_error",
    ddl: "notify_error TEXT",
    note: "最近一次通知失败的原因 —— 通知失败必须可见，不能静默丢掉",
  },
  {
    table: "leads",
    column: "next_follow_up_at",
    ddl: "next_follow_up_at TEXT",
    note: "下次跟进时间，用于逾期提醒",
  },
  ...LOCAL_COLUMN_MIGRATIONS.map((m) => ({ ...m })),
  ...PUBLISH_COLUMN_MIGRATIONS.map((m) => ({ ...m })),
  ...PUBLIC_COLUMN_MIGRATIONS.map((m) => ({ ...m })),
];

export interface MigrationOutcome {
  applied: string[];
  skipped: string[];
  failed: Array<{ target: string; error: string }>;
}

function existingColumns(db: DatabaseSync, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

export function runColumnMigrations(db: DatabaseSync): MigrationOutcome {
  const outcome: MigrationOutcome = { applied: [], skipped: [], failed: [] };

  for (const m of COLUMN_MIGRATIONS) {
    const target = `${m.table}.${m.column}`;
    const cols = existingColumns(db, m.table);
    if (cols.size === 0) {
      // 表还不存在（全新库）—— CREATE TABLE 已经带上该列，无需 ALTER
      outcome.skipped.push(target);
      continue;
    }
    if (cols.has(m.column)) {
      outcome.skipped.push(target);
      continue;
    }
    try {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.ddl}`);
      outcome.applied.push(target);
      try {
        db.prepare(
          `INSERT INTO change_logs (id, workspace_id, actor, action, entity, entity_id, detail_json, created_at)
           VALUES (?, 'system', 'migration', 'add_column', ?, ?, ?, ?)`,
        ).run(
          `mig_${Date.now()}_${m.column}`,
          m.table,
          m.column,
          JSON.stringify({ column: m.column, ddl: m.ddl, note: m.note }),
          new Date().toISOString(),
        );
      } catch {
        /* 审计写入失败不应阻断迁移本身 */
      }
    } catch (e) {
      outcome.failed.push({ target, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return outcome;
}
