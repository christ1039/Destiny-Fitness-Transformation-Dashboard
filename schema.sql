-- Destiny Fitness Dashboard cross-device sync
-- Cloudflare D1 schema

CREATE TABLE IF NOT EXISTS dashboard_states (
  whop_user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  app_version TEXT,
  client_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (whop_user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_states_updated_at
ON dashboard_states(updated_at);
