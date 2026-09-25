/**
 * 采样协议与问题分类的数据库定义。
 *
 * 为什么协议要单独存一张表，而不是把条件写在 sampling_runs 上：
 * 一份协议会被多次复测复用（基线一次、第 7/14/28 天各一次），
 * 条件必须**独立于单次采样**存在。否则每次复测都要重抄一遍条件，
 * 抄错一项，前后对比就悄悄失效了。
 */
import { CATEGORY_VALUES } from "../protocol.ts";

const categoryCheck = CATEGORY_VALUES.map((v) => `'${v}'`).join(",");

export const PROTOCOL_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS sampling_protocols (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  query_set_id      TEXT NOT NULL REFERENCES query_sets(id) ON DELETE CASCADE,
  -- 冻结时的版本号。版本变了就是另一份协议，不能混算
  query_set_version INTEGER NOT NULL,
  label             TEXT NOT NULL,
  engines_json      TEXT NOT NULL DEFAULT '[]',
  repetition        INTEGER NOT NULL DEFAULT 1,
  region            TEXT,
  -- 平台是否开启联网检索：开着和关着是两个不同的系统
  web_search        INTEGER NOT NULL DEFAULT 0,
  -- manual_ui（消费者界面人工）| official_api（官方 API）
  surface           TEXT NOT NULL DEFAULT 'manual_ui',
  location_mode     TEXT NOT NULL DEFAULT 'unspecified',
  anchor_id         TEXT,
  daypart           TEXT,
  model_version     TEXT,
  -- 指纹相同的协议才允许直接前后对比
  fingerprint       TEXT NOT NULL,
  -- 由哪份协议复制而来（复测协议记录来源，便于追溯）
  cloned_from       TEXT,
  locked_at         TEXT,
  note              TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (workspace_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_protocols_qs ON sampling_protocols(query_set_id);
`;

export const PROTOCOL_COLUMN_MIGRATIONS = [
  {
    table: "questions",
    column: "category",
    ddl: `category TEXT CHECK (category IS NULL OR category IN (${categoryCheck}))`,
    note: "问题分类：认知题 / 推荐题 / 对比场景题 —— 只有推荐题与场景题能判断能否被推荐",
  },
  {
    table: "sampling_runs",
    column: "protocol_id",
    ddl: "protocol_id TEXT",
    note: "采样批次所属协议；指标按协议分组，跨协议不混算",
  },
  {
    table: "sampling_runs",
    column: "web_search",
    ddl: "web_search INTEGER NOT NULL DEFAULT 0",
    note: "该批次是否在联网检索模式下采集 —— 与不联网是两个不同的系统",
  },
  {
    table: "response_samples",
    column: "web_search",
    ddl: "web_search INTEGER NOT NULL DEFAULT 0",
    note: "样本级联网标记，随批次写入后不可变",
  },
  {
    table: "response_samples",
    column: "model_version",
    ddl: "model_version TEXT",
    note: "平台声明的模型版本；平台会静默更新模型，记录版本才能解释变化",
  },
] as const;
