/**
 * 数据库 Schema（SQLite）
 *
 * 设计依据：附件《GEO系统技术架构与代码搭建方案》§7 核心数据库设计。
 *
 * 与文档的两处有意偏离，均已记录：
 *  1. 文档 §4.2 推荐 PostgreSQL + Drizzle ORM。批次1 采用 Node 内置 node:sqlite
 *     + 手写 SQL，原因是零原生依赖、零编译风险、单文件可跑；所有 SQL 集中在
 *     src/lib/db/repo.ts，将来切 Postgres 只需替换该文件与连接层。
 *  2. 文档 §7.8 要求所有核心表带 workspace_id —— 已完整保留，即使批次1 只使用
 *     一个工作区，这样将来开多工作区不需要改表。
 *
 * 批次1 实际使用的表：workspaces, brands, brand_aliases, competitors,
 * query_sets, questions, tool_runs, leads, events。
 * 其余表（采样/评估/内容/推广）先建好，批次2 直接写入，避免中途迁移。
 */

export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ========== 1. 身份与品牌（§7.1） ==========
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  domain       TEXT,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  metadata     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brands_ws ON brands(workspace_id);

CREATE TABLE IF NOT EXISTS brand_aliases (
  id        TEXT PRIMARY KEY,
  brand_id  TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'alias',   -- alias | wrong_spelling | former_name
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_aliases_brand ON brand_aliases(brand_id);

CREATE TABLE IF NOT EXISTS competitors (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id     TEXT REFERENCES brands(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  domain       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_competitors_brand ON competitors(brand_id);

-- ========== 2. 问题库（§7.2） ==========
CREATE TABLE IF NOT EXISTS query_sets (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id     TEXT REFERENCES brands(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft|reviewed|active|frozen|archived
  frozen_at    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  query_set_id  TEXT REFERENCES query_sets(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  persona       TEXT,
  intent        TEXT,          -- 认知|比较|操作|风险|交易|品牌|替代
  funnel_stage  TEXT,          -- 早期|中期|后期
  locale        TEXT NOT NULL DEFAULT 'zh-CN',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_qs ON questions(query_set_id);

-- ========== 3. 采样与评估（§7.5，批次2 写入） ==========
CREATE TABLE IF NOT EXISTS sampling_runs (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  query_set_id TEXT REFERENCES query_sets(id),
  label        TEXT NOT NULL,
  sampling_mode TEXT NOT NULL DEFAULT 'manual_ui',
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS response_samples (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id        TEXT REFERENCES sampling_runs(id) ON DELETE CASCADE,
  question_id   TEXT REFERENCES questions(id),
  engine        TEXT NOT NULL,
  sampling_mode TEXT NOT NULL DEFAULT 'manual_ui',
  region        TEXT,
  repetition    INTEGER NOT NULL DEFAULT 1,
  raw_answer    TEXT NOT NULL,
  content_hash  TEXT,
  collected_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_run ON response_samples(run_id);

CREATE TABLE IF NOT EXISTS response_citations (
  id         TEXT PRIMARY KEY,
  sample_id  TEXT NOT NULL REFERENCES response_samples(id) ON DELETE CASCADE,
  url        TEXT,
  domain     TEXT,
  anchor     TEXT,
  position   INTEGER
);

CREATE TABLE IF NOT EXISTS response_mentions (
  id         TEXT PRIMARY KEY,
  sample_id  TEXT NOT NULL REFERENCES response_samples(id) ON DELETE CASCADE,
  entity     TEXT NOT NULL,          -- 品牌名或竞品名
  is_target  INTEGER NOT NULL DEFAULT 0,
  position   INTEGER,                -- 首次出现位置（字符偏移）
  list_rank  INTEGER,                -- 列表排名
  sentiment  TEXT,                   -- positive|neutral|negative
  snippet    TEXT
);

-- ========== 4. 免费工具与结果页（§6.7） ==========
CREATE TABLE IF NOT EXISTS tool_runs (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool         TEXT NOT NULL,        -- crawler | citability | question_map | visibility_log
  share_slug   TEXT NOT NULL UNIQUE,
  input_json   TEXT NOT NULL,
  result_json  TEXT NOT NULL,
  is_public    INTEGER NOT NULL DEFAULT 0,   -- 默认 noindex（持链接可访问），用户主动公开后才允许索引
  status       TEXT NOT NULL DEFAULT 'done',
  ip_hash      TEXT,
  user_agent   TEXT,
  referrer     TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_runs_created ON tool_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_tool_runs_tool ON tool_runs(tool);

-- ========== 5. 访问与线索（§7.7） ==========
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  path         TEXT,
  referrer     TEXT,
  utm_json     TEXT NOT NULL DEFAULT '{}',
  session_id   TEXT,
  tool_run_id  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

CREATE TABLE IF NOT EXISTS leads (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email                TEXT,
  name                 TEXT,
  company              TEXT,
  website              TEXT,
  message              TEXT,
  self_reported_source TEXT,
  source               TEXT,           -- 入口：工具名 / 页面路径
  status               TEXT NOT NULL DEFAULT 'new', -- new|contacted|qualified|won|lost
  first_touch_json     TEXT NOT NULL DEFAULT '{}',
  tool_run_id          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

-- ========== 6. 操作日志（§6.1 要求：发布/删除/导出写审计） ==========
CREATE TABLE IF NOT EXISTS change_logs (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor        TEXT NOT NULL DEFAULT 'system',
  action       TEXT NOT NULL,
  entity       TEXT,
  entity_id    TEXT,
  detail_json  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);
`;

/** 批次1 默认工作区（多工作区 schema 已就位，UI 先只用这一个） */
export const DEFAULT_WORKSPACE = {
  slug: "default",
  name: "默认工作区",
};
