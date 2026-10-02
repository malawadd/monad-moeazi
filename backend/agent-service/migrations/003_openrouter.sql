ALTER TABLE provider_secrets
  DROP CONSTRAINT IF EXISTS provider_secrets_provider_check;

ALTER TABLE provider_secrets
  ADD CONSTRAINT provider_secrets_provider_check
  CHECK (provider IN ('openai', 'deepseek', 'openrouter'));

ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS served_model text;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS upstream_provider text;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS model_family text;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS routing_strategy text;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS fallback_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS generation_id text;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS cost_source text NOT NULL DEFAULT 'rate_estimate';
