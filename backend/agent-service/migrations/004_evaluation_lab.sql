CREATE TABLE IF NOT EXISTS evaluation_experiments (
  experiment_id text PRIMARY KEY,
  owner_subject text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','running','paused','completed','canceled','failed')),
  mode text NOT NULL CHECK (mode IN ('replay','live_shadow','replay_and_live_shadow')),
  spec jsonb NOT NULL,
  market_universe jsonb NOT NULL DEFAULT '[]'::jsonb,
  projected_cost_microusd bigint NOT NULL DEFAULT 0,
  actual_cost_microusd bigint NOT NULL DEFAULT 0,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation_cases (
  case_id text NOT NULL,
  experiment_id text NOT NULL REFERENCES evaluation_experiments(experiment_id),
  market text NOT NULL,
  case_kind text NOT NULL CHECK (case_kind IN ('replay','live_shadow','adversarial')),
  repetition integer NOT NULL DEFAULT 1,
  market_snapshot jsonb NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, created_at)
);
SELECT create_hypertable('evaluation_cases', by_range('created_at'), if_not_exists => TRUE);
SELECT add_retention_policy('evaluation_cases', INTERVAL '90 days', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  run_id text NOT NULL,
  experiment_id text NOT NULL,
  case_id text NOT NULL,
  subject_id text NOT NULL,
  analysis_id text,
  status text NOT NULL,
  prompt_bundle jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  provider_cost_microusd bigint NOT NULL DEFAULT 0,
  latency_ms bigint NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (run_id, created_at)
);
SELECT create_hypertable('evaluation_runs', by_range('created_at'), if_not_exists => TRUE);
SELECT add_retention_policy('evaluation_runs', INTERVAL '90 days', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS evaluation_forecast_outcomes (
  outcome_id text PRIMARY KEY,
  experiment_id text NOT NULL,
  run_id text NOT NULL,
  subject_id text NOT NULL,
  market text NOT NULL,
  horizon text NOT NULL,
  forecast jsonb NOT NULL,
  start_price double precision NOT NULL,
  end_price double precision,
  actual_direction text,
  brier_score double precision,
  due_at timestamptz NOT NULL,
  settled_at timestamptz
);

CREATE TABLE IF NOT EXISTS evaluation_simulated_fills (
  fill_id text PRIMARY KEY,
  experiment_id text NOT NULL,
  run_id text NOT NULL,
  subject_id text NOT NULL,
  strategy_mode text NOT NULL,
  market text NOT NULL,
  side text NOT NULL,
  notional_usd double precision NOT NULL,
  leverage double precision NOT NULL,
  entry_price double precision NOT NULL,
  exit_price double precision,
  fees_usd double precision NOT NULL DEFAULT 0,
  slippage_usd double precision NOT NULL DEFAULT 0,
  funding_usd double precision NOT NULL DEFAULT 0,
  stop_price double precision,
  take_price double precision,
  funding_rate_hourly double precision NOT NULL DEFAULT 0,
  maximum_hold_at timestamptz,
  pnl_usd double precision,
  status text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS evaluation_scorecards (
  experiment_id text NOT NULL,
  subject_id text NOT NULL,
  scorecard jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, subject_id)
);

CREATE TABLE IF NOT EXISTS evaluation_annotations (
  annotation_id text PRIMARY KEY,
  experiment_id text NOT NULL,
  run_id text,
  owner_subject text NOT NULL,
  body text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_experiments_owner_created
  ON evaluation_experiments(owner_subject, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_cases_experiment_market
  ON evaluation_cases(experiment_id, market, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_runs_experiment_subject
  ON evaluation_runs(experiment_id, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_outcomes_due
  ON evaluation_forecast_outcomes(due_at) WHERE settled_at IS NULL;
