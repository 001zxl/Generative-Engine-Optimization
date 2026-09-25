/**
 * 第三方信源台账。
 *
 * 为什么单独建表而不是复用 publication_checks：
 * publication_checks 记的是"我们自己发布出去的内容现在能不能访问"，
 * 而这张表记的是**别人写的、能给我们背书的外部页面**。
 * 两者混在一起会导致一个很危险的混淆：把自家发的文章当成第三方报道。
 * 那正是这类产品最容易被戳穿的地方。
 */
export const EXTERNAL_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS external_sources (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 归属客户：品牌或门店二选一（至少一个）
  brand_id        TEXT REFERENCES brands(id) ON DELETE CASCADE,
  store_id        TEXT REFERENCES stores(id) ON DELETE CASCADE,
  -- 这条来源为哪条事实背书；可为空（尚未与事实绑定）
  claim_id        TEXT REFERENCES claims(id) ON DELETE SET NULL,
  platform        TEXT NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT,
  topic           TEXT,
  -- 来源性质：自有内容 / 客户授权渠道 / 独立第三方。**不得混用**
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('owned','authorized','independent')),
  published_at    TEXT,
  last_checked_at TEXT,
  -- 最近一次可用性核对结果
  last_status     TEXT NOT NULL DEFAULT 'unknown' CHECK (last_status IN ('ok','dead','blocked','mismatch','unknown')),
  last_http_status INTEGER,
  last_note       TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (workspace_id, url)
);
CREATE INDEX IF NOT EXISTS idx_external_sources_brand ON external_sources(brand_id);
CREATE INDEX IF NOT EXISTS idx_external_sources_claim ON external_sources(claim_id);
CREATE INDEX IF NOT EXISTS idx_external_sources_kind ON external_sources(source_kind);
`;

export const EXTERNAL_COLUMN_MIGRATIONS = [
  {
    table: "external_sources",
    column: "conflict_note",
    ddl: "conflict_note TEXT",
    note: "与该事实其它来源冲突时的说明；有值即表示存在需要人工判断的矛盾",
  },
  {
    table: "external_sources",
    column: "conflict_with_id",
    ddl: "conflict_with_id TEXT",
    note: "与哪条来源冲突（自引用），便于并排查看",
  },
] as const;
