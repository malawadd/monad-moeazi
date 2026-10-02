CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id text PRIMARY KEY,
  source text NOT NULL,
  reference text NOT NULL,
  observed_at timestamptz NOT NULL,
  event_at timestamptz,
  quality_score double precision NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
  content_hash text NOT NULL,
  sanitized_content text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  analysis_id text NOT NULL,
  market text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('focus', 'pro', 'max')),
  scope text NOT NULL CHECK (scope IN ('public', 'private')),
  account_id text,
  consensus double precision NOT NULL,
  confidence double precision NOT NULL,
  disagreement double precision NOT NULL,
  freshness_ms bigint NOT NULL,
  synthesis jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  PRIMARY KEY (analysis_id, created_at)
);
SELECT create_hypertable('analysis_runs', by_range('created_at'), if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS signal_reports (
  id bigserial,
  analysis_id text NOT NULL,
  role text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  score double precision NOT NULL,
  confidence double precision NOT NULL,
  report jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
);
SELECT create_hypertable('signal_reports', by_range('created_at'), if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS provider_calls (
  id bigserial PRIMARY KEY,
  analysis_id text NOT NULL,
  role text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  latency_ms integer NOT NULL,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysis_market_created ON analysis_runs (market, created_at DESC);
CREATE INDEX IF NOT EXISTS signal_analysis ON signal_reports (analysis_id);
CREATE INDEX IF NOT EXISTS provider_call_analysis ON provider_calls (analysis_id);
