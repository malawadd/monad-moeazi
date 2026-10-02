-- Local fixture-only immutable decision-memory receipts. No product projection.
CREATE TABLE IF NOT EXISTS decision_memory_scopes (
  scope_hash char(64) PRIMARY KEY, operator_test_id text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS decision_memory_episodes (
  episode_hash char(64) PRIMARY KEY, scope_hash char(64) NOT NULL REFERENCES decision_memory_scopes(scope_hash),
  episode_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_hash, episode_id)
);
CREATE TABLE IF NOT EXISTS decision_memory_outcome_revisions (
  revision_hash char(64) PRIMARY KEY, episode_hash char(64) NOT NULL REFERENCES decision_memory_episodes(episode_hash),
  revision integer NOT NULL CHECK (revision > 0), predecessor_hash char(64), payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(episode_hash, revision)
);
CREATE TABLE IF NOT EXISTS decision_memory_receipts (
  receipt_hash char(64) PRIMARY KEY, episode_hash char(64) NOT NULL REFERENCES decision_memory_episodes(episode_hash),
  kind text NOT NULL CHECK (kind IN ('maturity','score','bundle','invalidation','persistence')), payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decision_memory_episode_scope_created_idx ON decision_memory_episodes(scope_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS decision_memory_outcome_episode_revision_idx ON decision_memory_outcome_revisions(episode_hash, revision DESC);
