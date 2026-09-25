/**
 * 公开实体页（品牌页 / 门店页）的发布状态与内容快照。
 *
 * 为什么单独一张表而不是复用 content_assets：
 * 实体页的内容来自结构化字段（门店地址、营业时间、已批准事实），
 * 不是一篇 Markdown。更重要的是**审核发布状态必须显式**——
 * 运营台里出现过的每一个品牌和门店都自动变成公开页面，
 * 是这类系统最危险的一种默认行为。
 */
export const PUBLIC_ENTITY_TYPES = ["brand", "store"] as const;
export type PublicEntityType = (typeof PUBLIC_ENTITY_TYPES)[number];

export const PUBLIC_PAGE_STATUS = [
  { value: "draft", label: "草稿" },
  { value: "in_review", label: "待审核" },
  { value: "published", label: "已公开" },
  { value: "archived", label: "已下线" },
] as const;

export const PUBLIC_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS public_pages (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('brand','store')),
  entity_id      TEXT NOT NULL,
  slug           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','published','archived')),
  -- 审核通过/发布那一刻的内容快照：之后改门店资料不会静默改掉已公开页面
  snapshot_json  TEXT NOT NULL DEFAULT '{}',
  snapshot_hash  TEXT,
  reviewed_by    TEXT,
  reviewed_at    TEXT,
  published_at   TEXT,
  archived_at    TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (workspace_id, entity_type, entity_id),
  UNIQUE (workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_public_pages_status ON public_pages(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_public_pages_slug ON public_pages(slug);
`;

export const PUBLIC_COLUMN_MIGRATIONS = [
  {
    table: "public_pages",
    column: "snapshot_hash",
    ddl: "snapshot_hash TEXT",
    note: "快照内容哈希：用于判断已公开页面是否与当前资料不一致",
  },
  {
    table: "public_pages",
    column: "archived_at",
    ddl: "archived_at TEXT",
    note: "下线时间；下线后页面必须立即不可公开访问",
  },
] as const;
