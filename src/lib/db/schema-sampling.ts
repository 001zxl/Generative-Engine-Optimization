/** Source provenance and API claim state are additive to the existing sampling tables. */
export const SAMPLING_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS sample_provenance (
  sample_id TEXT PRIMARY KEY REFERENCES response_samples(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL UNIQUE REFERENCES sampling_tasks(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('manual_ui', 'official_api', 'fixture')),
  model_version TEXT NOT NULL,
  source_url TEXT,
  citations_json TEXT NOT NULL DEFAULT '[]',
  provider_response_id TEXT,
  search_enabled INTEGER,
  request_config_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sampling_api_attempts (
  task_id TEXT PRIMARY KEY REFERENCES sampling_tasks(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('sending', 'failed', 'uncertain', 'succeeded')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
