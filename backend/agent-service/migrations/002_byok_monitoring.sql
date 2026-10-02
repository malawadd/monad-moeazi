CREATE TABLE IF NOT EXISTS provider_secrets (
  secret_ref text PRIMARY KEY,
  subject_hash text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'deepseek')),
  ciphertext text NOT NULL,
  kms_key_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_trace_events (
  event_id text NOT NULL,
  analysis_id text NOT NULL,
  account_id text,
  parent_event_id text,
  event_type text NOT NULL,
  role text,
  provider text,
  model text,
  credential_source text,
  status text NOT NULL,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_summary text,
  input_tokens bigint NOT NULL DEFAULT 0,
  cached_input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  provider_cost_microusd bigint NOT NULL DEFAULT 0,
  platform_credits integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  retry_number integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (event_id, created_at)
);
SELECT create_hypertable('agent_trace_events', by_range('created_at'), if_not_exists => TRUE);
SELECT add_retention_policy('agent_trace_events', INTERVAL '7 days', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS agent_usage_daily (
  day date NOT NULL,
  account_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  credential_source text NOT NULL,
  calls bigint NOT NULL DEFAULT 0,
  successful_calls bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  cached_input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  provider_cost_microusd bigint NOT NULL DEFAULT 0,
  platform_credits bigint NOT NULL DEFAULT 0,
  latency_ms bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, account_id, provider, model, credential_source)
);

ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS model_configuration_version integer;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS billing_route jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS credential_source text;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS input_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS cached_input_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS output_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS provider_cost_microusd bigint NOT NULL DEFAULT 0;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS platform_credits integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS trace_analysis_created ON agent_trace_events (analysis_id, created_at);
CREATE INDEX IF NOT EXISTS trace_account_created ON agent_trace_events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_account_day ON agent_usage_daily (account_id, day DESC);
