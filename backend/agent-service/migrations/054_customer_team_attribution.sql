ALTER TABLE analysis_runs
  ADD COLUMN IF NOT EXISTS team_id text,
  ADD COLUMN IF NOT EXISTS team_version_id text,
  ADD COLUMN IF NOT EXISTS deployment_id text;
ALTER TABLE provider_calls
  ADD COLUMN IF NOT EXISTS team_id text,
  ADD COLUMN IF NOT EXISTS team_version_id text,
  ADD COLUMN IF NOT EXISTS deployment_id text;
ALTER TABLE agent_trace_events
  ADD COLUMN IF NOT EXISTS team_id text,
  ADD COLUMN IF NOT EXISTS team_version_id text,
  ADD COLUMN IF NOT EXISTS deployment_id text;

CREATE TABLE IF NOT EXISTS agent_usage_daily_team (
  day date NOT NULL,
  account_id text NOT NULL,
  team_id text NOT NULL,
  team_version_id text NOT NULL,
  deployment_id text NOT NULL DEFAULT '',
  market_id text NOT NULL,
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
  PRIMARY KEY (day, account_id, team_id, team_version_id, deployment_id, market_id,
               provider, model, credential_source)
);
CREATE INDEX IF NOT EXISTS analysis_runs_account_team_created
  ON analysis_runs(account_id, team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_usage_account_day
  ON agent_usage_daily_team(account_id, day DESC, team_id);

ALTER TABLE evaluation_previews
  ADD COLUMN IF NOT EXISTS customer_team_id text,
  ADD COLUMN IF NOT EXISTS customer_account_id text;
ALTER TABLE evaluation_experiments
  ADD COLUMN IF NOT EXISTS customer_team_id text,
  ADD COLUMN IF NOT EXISTS customer_account_id text;
CREATE INDEX IF NOT EXISTS customer_evaluations_owner_team_created
  ON evaluation_experiments(owner_subject, customer_team_id, created_at DESC)
  WHERE customer_team_id IS NOT NULL;
