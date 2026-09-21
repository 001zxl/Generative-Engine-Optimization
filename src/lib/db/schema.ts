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
 * 全部 7 个业务模块所需的表都在此文件内一次性定义（建表全部使用 IF NOT EXISTS，
 * 因此是纯增量、可重复执行）。模块与表的对应关系见 README §10。
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
  -- 跟进责任与通知状态（旧库由 src/lib/db/migrate.ts 幂等补列）
  owner                TEXT,           -- 跟进责任人；NULL 表示尚未指派
  next_follow_up_at    TEXT,           -- 下次跟进时间，用于逾期提醒
  notified_at          TEXT,           -- 最近一次通知成功的时间
  notify_error         TEXT,           -- 最近一次通知失败的原因（失败必须可见）
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

-- ========== 7. 模块2 补充：问题库的 Persona / 标签 / Prompt 变体（§7.2） ==========
CREATE TABLE IF NOT EXISTS personas (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id     TEXT REFERENCES brands(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_tags (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  question_id  TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag          TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_question_tags_q ON question_tags(question_id);

CREATE TABLE IF NOT EXISTS prompt_variants (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  question_id  TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  engine       TEXT NOT NULL,
  text         TEXT NOT NULL,
  locale       TEXT NOT NULL DEFAULT 'zh-CN',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_variants_q ON prompt_variants(question_id);

-- ========== 8. 模块3：品牌事实与证据（§7.3） ==========
CREATE TABLE IF NOT EXISTS claims (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id     TEXT REFERENCES brands(id) ON DELETE CASCADE,
  claim_key    TEXT NOT NULL,            -- 事实的机器可读标识，如 moq
  statement    TEXT NOT NULL,            -- 对外可引用的标准陈述
  category     TEXT,                     -- 资质|产能|交付|价格|服务|团队
  status       TEXT NOT NULL DEFAULT 'draft', -- draft|pending_review|approved|expired|rejected
  valid_from   TEXT,
  valid_until  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_brand ON claims(brand_id);

CREATE TABLE IF NOT EXISTS claim_versions (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  statement    TEXT NOT NULL,
  changed_by   TEXT NOT NULL DEFAULT 'system',
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claim_versions_claim ON claim_versions(claim_id);

CREATE TABLE IF NOT EXISTS evidences (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  claim_id       TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'url',  -- url|document|case|certificate|dataset
  title          TEXT NOT NULL,
  url            TEXT,
  publisher      TEXT,
  published_at   TEXT,
  evidence_level TEXT NOT NULL DEFAULT 'self', -- third_party|official|audited|self
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidences_claim ON evidences(claim_id);

CREATE TABLE IF NOT EXISTS prohibited_phrases (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id     TEXT REFERENCES brands(id) ON DELETE CASCADE,
  phrase       TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'warn',  -- block|warn
  reason       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prohibited_brand ON prohibited_phrases(brand_id);

CREATE TABLE IF NOT EXISTS review_decisions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity       TEXT NOT NULL,           -- claim|content_asset
  entity_id    TEXT NOT NULL,
  decision     TEXT NOT NULL,           -- approved|rejected|changes_requested
  actor        TEXT NOT NULL DEFAULT 'system',
  note         TEXT,
  decided_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_entity ON review_decisions(entity, entity_id);

-- ========== 9. 模块4 补充：引擎注册表（§7.5） ==========
CREATE TABLE IF NOT EXISTS engines (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,           -- ChatGPT|Perplexity|豆包|千问 ...
  vendor       TEXT,
  region       TEXT NOT NULL DEFAULT 'global',
  has_public_api INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TEXT NOT NULL
);

-- 采样任务（一次采样批次下的单个「问题 × 引擎」单位）
CREATE TABLE IF NOT EXISTS sampling_tasks (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id        TEXT NOT NULL REFERENCES sampling_runs(id) ON DELETE CASCADE,
  question_id   TEXT NOT NULL REFERENCES questions(id),
  question_text TEXT NOT NULL,          -- 冻结快照：问题版本变了也不影响历史
  engine        TEXT NOT NULL,
  region        TEXT,
  repetition    INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|collected|skipped
  idempotency_key TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sampling_tasks_idem ON sampling_tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sampling_tasks_run ON sampling_tasks(run_id);

-- ========== 10. 模块5 补充：评估结果与指标快照（§7.5） ==========
CREATE TABLE IF NOT EXISTS evaluation_results (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sample_id         TEXT NOT NULL REFERENCES response_samples(id) ON DELETE CASCADE,
  evaluator         TEXT NOT NULL,       -- mention|position|citation|competitor|sentiment|fact
  evaluator_version TEXT NOT NULL,
  result_json       TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 1,
  needs_review      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_sample ON evaluation_results(sample_id);
CREATE INDEX IF NOT EXISTS idx_eval_evaluator ON evaluation_results(evaluator);

CREATE TABLE IF NOT EXISTS human_reviews (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  sample_id    TEXT NOT NULL REFERENCES response_samples(id) ON DELETE CASCADE,
  evaluator    TEXT NOT NULL,
  decision     TEXT NOT NULL,           -- confirmed|corrected
  corrected_json TEXT,
  reviewer     TEXT NOT NULL DEFAULT 'operator',
  note         TEXT,
  reviewed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_human_reviews_sample ON human_reviews(sample_id);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id        TEXT REFERENCES sampling_runs(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL,          -- mention_rate|top1_rate|sov|owned_citation_rate|fact_accuracy
  value         REAL NOT NULL,
  numerator     INTEGER NOT NULL,
  denominator   INTEGER NOT NULL,
  dimension_json TEXT NOT NULL DEFAULT '{}',
  computed_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_run ON metric_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_metric_name ON metric_snapshots(metric);

-- ========== 11. 模块6：内容与推广（§7.4） ==========
CREATE TABLE IF NOT EXISTS content_briefs (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id     TEXT REFERENCES brands(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  gap_reason   TEXT,                    -- 为什么写这篇：来自哪个问题缺口
  outline      TEXT,
  status       TEXT NOT NULL DEFAULT 'draft', -- draft|ready|in_production|done|dropped
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_assets (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brief_id     TEXT REFERENCES content_briefs(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'article', -- article|faq|comparison|research|case
  title        TEXT NOT NULL,
  slug         TEXT,
  body_md      TEXT,
  status       TEXT NOT NULL DEFAULT 'draft', -- draft|in_review|approved|published|archived
  author       TEXT,
  reviewer     TEXT,
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_status ON content_assets(status);

CREATE TABLE IF NOT EXISTS content_versions (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body_md    TEXT,
  editor     TEXT NOT NULL DEFAULT 'system',
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_versions_asset ON content_versions(asset_id);

CREATE TABLE IF NOT EXISTS content_question_links (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cql_asset ON content_question_links(asset_id);

CREATE TABLE IF NOT EXISTS content_claim_links (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  claim_id   TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ccl_asset ON content_claim_links(asset_id);

CREATE TABLE IF NOT EXISTS distribution_channels (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,           -- owned|earned|community|social|directory|partner
  name         TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_tasks (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id     TEXT NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  channel_id   TEXT REFERENCES distribution_channels(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'planned', -- planned|preparing|published|verified|dropped
  owner        TEXT,
  due_at       TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pub_tasks_asset ON publication_tasks(asset_id);

CREATE TABLE IF NOT EXISTS publications (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES publication_tasks(id) ON DELETE SET NULL,
  asset_id     TEXT NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  url          TEXT,
  published_at TEXT,
  fee          REAL,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publications_asset ON publications(asset_id);

CREATE TABLE IF NOT EXISTS publication_checks (
  id             TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  status_code    INTEGER,
  ok             INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  checked_at     TEXT NOT NULL
);

-- ========== 12. 模块7 补充：多触点归因（§7.7） ==========
CREATE TABLE IF NOT EXISTS lead_touchpoints (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id      TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,           -- first_touch|last_non_direct|self_reported|assist
  path         TEXT,
  referrer     TEXT,
  tool_run_id  TEXT,
  note         TEXT,
  occurred_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_touchpoints_lead ON lead_touchpoints(lead_id);

CREATE TABLE IF NOT EXISTS lead_status_history (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  lead_id      TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  actor        TEXT NOT NULL DEFAULT 'operator',
  note         TEXT,
  changed_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_status_lead ON lead_status_history(lead_id);
`;

/** 批次1 默认工作区（多工作区 schema 已就位，UI 先只用这一个） */
export const DEFAULT_WORKSPACE = {
  slug: "default",
  name: "默认工作区",
};
