/** 固定问题与采样协议的前后观察实验；旧批次结构保持兼容。 */
export const EXPERIMENTS_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS geo_experiments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL,
  baseline_run_id TEXT NOT NULL REFERENCES sampling_runs(id),
  protocol_json TEXT NOT NULL,
  intervention TEXT NOT NULL DEFAULT '',
  published_urls_json TEXT NOT NULL DEFAULT '[]',
  retest_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_experiments_ws ON geo_experiments(workspace_id);
CREATE TABLE IF NOT EXISTS experiment_retests (
  experiment_id TEXT NOT NULL REFERENCES geo_experiments(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES sampling_runs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, run_id)
);
`;
