/**
 * 列迁移的单测。
 *
 * 为什么需要它：schema 全部用 CREATE TABLE IF NOT EXISTS 定义，
 * 给**已存在**的表加列不会生效 —— 给 leads 加 owner/notified_at 时就卡在这里。
 * 迁移必须幂等，否则每次启动都会重复执行或报错。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runColumnMigrations, COLUMN_MIGRATIONS } from "../src/lib/db/migrate.ts";

function freshDb(opts: { withLeadsOld: boolean }): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE change_logs (
    id TEXT PRIMARY KEY, workspace_id TEXT, actor TEXT, action TEXT,
    entity TEXT, entity_id TEXT, detail_json TEXT, created_at TEXT);`);
  if (opts.withLeadsOld) {
    // 模拟"旧库"：leads 表没有新列
    db.exec(`CREATE TABLE leads (id TEXT PRIMARY KEY, workspace_id TEXT, email TEXT, created_at TEXT);`);
  }
  return db;
}

test("旧库：缺失的列会被补上", () => {
  const db = freshDb({ withLeadsOld: true });
  const out = runColumnMigrations(db);
  assert.ok(out.applied.includes("leads.owner"), "应补 owner 列");
  assert.ok(out.applied.includes("leads.notified_at"), "应补 notified_at 列");
  assert.ok(out.applied.includes("leads.notify_error"), "应补 notify_error 列");
  assert.equal(out.failed.length, 0, JSON.stringify(out.failed));

  const cols = (db.prepare("PRAGMA table_info(leads)").all() as unknown as Array<{ name: string }>).map((c) => c.name);
  for (const m of COLUMN_MIGRATIONS.filter((x) => x.table === "leads")) {
    assert.ok(cols.includes(m.column), `${m.column} 应存在`);
  }
});

test("幂等：重复执行不报错、不重复应用", () => {
  const db = freshDb({ withLeadsOld: true });
  const first = runColumnMigrations(db);
  assert.ok(first.applied.length > 0);
  const second = runColumnMigrations(db);
  assert.equal(second.applied.length, 0, "第二次不应再应用任何列");
  assert.equal(second.failed.length, 0);
  assert.equal(second.skipped.length, COLUMN_MIGRATIONS.length, "应全部跳过");
});

test("全新库（表还不存在）：跳过而不是报错", () => {
  const db = freshDb({ withLeadsOld: false });
  const out = runColumnMigrations(db);
  assert.equal(out.failed.length, 0, "表不存在时不应报错");
  assert.equal(out.applied.length, 0, "表尚未建立，无需 ALTER");
});

test("迁移写入审计记录（谁在什么时候加了什么列）", () => {
  const db = freshDb({ withLeadsOld: true });
  runColumnMigrations(db);
  const logs = db.prepare("SELECT action, entity, entity_id FROM change_logs").all() as unknown as Array<{
    action: string;
    entity: string;
    entity_id: string;
  }>;
  assert.ok(logs.length >= COLUMN_MIGRATIONS.filter((m) => m.table === "leads").length);
  assert.ok(logs.every((l) => l.action === "add_column" && l.entity === "leads"));
});

test("每条迁移都写了说明（便于后来者理解为什么加这一列）", () => {
  for (const m of COLUMN_MIGRATIONS) {
    assert.ok(m.note.length > 8, `${m.table}.${m.column} 缺少说明`);
    assert.ok(m.ddl.includes(m.column), `${m.table}.${m.column} 的 ddl 与列名不一致`);
  }
});
