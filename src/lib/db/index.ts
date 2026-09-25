import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL, DEFAULT_WORKSPACE } from "./schema.ts";
import { SAMPLING_SQL } from "./schema-sampling.ts";
import { PUBLISHING_SQL } from "./schema-publishing.ts";
import { EXPERIMENTS_SQL } from "./schema-experiments.ts";
import { LOCAL_SQL } from "./schema-local.ts";
import { PUBLIC_SQL } from "./schema-public.ts";
import { PROTOCOL_SQL } from "./schema-protocol.ts";
import { EXTERNAL_SQL } from "./schema-external.ts";
import { runColumnMigrations } from "./migrate.ts";
import { newId } from "../id.ts";

declare global {
  // eslint-disable-next-line no-var
  var __geoDb: DatabaseSync | undefined;
}

export function dbPath(): string {
  const p = process.env.DATABASE_PATH ?? "./data/geo.db";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function open(): DatabaseSync {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA_SQL);
  db.exec(SAMPLING_SQL);
  db.exec(PUBLISHING_SQL);
  db.exec(EXPERIMENTS_SQL);
  db.exec(LOCAL_SQL);
  db.exec(PUBLIC_SQL);
  db.exec(PROTOCOL_SQL);
  db.exec(EXTERNAL_SQL);

  // 幂等补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加新列
  const mig = runColumnMigrations(db);
  if (mig.applied.length > 0) {
    console.log(`[db] 已应用列迁移: ${mig.applied.join(", ")}`);
  }
  for (const f of mig.failed) {
    console.error(`[db] ✖ 列迁移失败 ${f.target}: ${f.error}`);
  }

  // 幂等初始化默认工作区
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT id FROM workspaces WHERE slug = ?")
    .get(DEFAULT_WORKSPACE.slug) as { id: string } | undefined;
  if (!existing) {
    db.prepare(
      "INSERT INTO workspaces (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(newId("ws"), DEFAULT_WORKSPACE.slug, DEFAULT_WORKSPACE.name, now, now);
  }
  return db;
}

/**
 * 是否指向试点库（data/geo.db）。
 *
 * 用途：端到端测试与夹具脚本必须先问这一句，避免把测试数据写进真实库。
 * 试点库里堆过 19 条假线索，看起来像「已经有 19 个客户」——
 * 这种错误一旦进了对外报告就收不回来。
 */
export function isPilotDb(): boolean {
  return dbPath() === path.join(process.cwd(), "data", "geo.db");
}

/** 懒加载单例：避免在 next build 的静态分析阶段就创建数据文件 */
export function getDb(): DatabaseSync {
  if (!globalThis.__geoDb) {
    globalThis.__geoDb = open();
  }
  return globalThis.__geoDb;
}

export function workspaceId(): string {
  const slug = process.env.DEFAULT_WORKSPACE_SLUG ?? DEFAULT_WORKSPACE.slug;
  const row = getDb().prepare("SELECT id FROM workspaces WHERE slug = ?").get(slug) as
    | { id: string }
    | undefined;
  if (!row) throw new Error(`工作区不存在: ${slug}`);
  return row.id;
}

/** 审计日志（§6.1：发布/删除/导出必须留痕） */
export function audit(
  action: string,
  entity: string,
  entityId: string,
  detail: Record<string, unknown> = {},
  actor = "system",
): void {
  getDb()
    .prepare(
      `INSERT INTO change_logs (id, workspace_id, actor, action, entity, entity_id, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId("log"), workspaceId(), actor, action, entity, entityId, JSON.stringify(detail), new Date().toISOString());
}

export type Row = Record<string, unknown>;
