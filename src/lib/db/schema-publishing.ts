/** Additive publication execution state. Existing manual publication records remain intact. */
export const PUBLISHING_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS publication_dispatches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL UNIQUE REFERENCES publication_tasks(id) ON DELETE CASCADE,
  publication_id TEXT UNIQUE REFERENCES publications(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('own_site', 'wordpress', 'webhook')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'succeeded', 'failed', 'uncertain')),
  idempotency_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  slug TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  remote_id TEXT,
  published_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dispatches_ws ON publication_dispatches(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatches_own_slug ON publication_dispatches(slug) WHERE channel = 'own_site';
`;
