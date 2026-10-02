BEGIN;

-- Lifecycle scope is part of the physical identity of every mutable evidence body.
-- Rows whose owner cannot be proven remain non-disclosable as legacy_unbound.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS scope_key text;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS scope_key text;
ALTER TABLE evaluation_cases ADD COLUMN IF NOT EXISTS scope_key text;

UPDATE analysis_runs SET scope_key=CASE
  WHEN account_id IS NOT NULL AND btrim(account_id)<>'' THEN 'account:'||account_id
  WHEN scope='public' THEN 'public'
  ELSE 'legacy_unbound' END
WHERE scope_key IS NULL;

UPDATE agent_trace_events SET scope_key=CASE
  WHEN account_id IS NOT NULL AND btrim(account_id)<>'' THEN 'account:'||account_id
  ELSE 'legacy_unbound' END
WHERE scope_key IS NULL;

UPDATE evaluation_cases c SET scope_key=d.scope_key
FROM evidence_lifecycle_decisions d
WHERE c.lifecycle_decision_hash=d.decision_hash AND c.scope_key IS NULL
  AND d.scope_key ~ '^(account|tenant):[^:]{1,120}$';
UPDATE evaluation_cases SET scope_key='legacy_unbound' WHERE scope_key IS NULL;

ALTER TABLE analysis_runs ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE agent_trace_events ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evaluation_cases ALTER COLUMN scope_key SET NOT NULL;

ALTER TABLE analysis_runs DROP CONSTRAINT IF EXISTS analysis_runs_scope_key_check;
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_runs_scope_key_check CHECK (
  scope_key='legacy_unbound'
  OR (scope_key='public' AND account_id IS NULL)
  OR (scope_key ~ '^account:[^:]{1,120}$' AND account_id IS NOT NULL
      AND scope_key='account:'||account_id));

ALTER TABLE agent_trace_events DROP CONSTRAINT IF EXISTS agent_trace_events_scope_key_check;
ALTER TABLE agent_trace_events ADD CONSTRAINT agent_trace_events_scope_key_check CHECK (
  scope_key='legacy_unbound'
  OR (scope_key='public' AND account_id IS NULL)
  OR (scope_key ~ '^account:[^:]{1,120}$' AND account_id IS NOT NULL
      AND scope_key='account:'||account_id));

ALTER TABLE evaluation_cases DROP CONSTRAINT IF EXISTS evaluation_cases_scope_key_check;
ALTER TABLE evaluation_cases ADD CONSTRAINT evaluation_cases_scope_key_check CHECK (
  scope_key='legacy_unbound' OR scope_key='public'
  OR scope_key ~ '^(account|tenant):[^:]{1,120}$');

-- Timescale uniqueness must include the time partition while scope prevents
-- same-id/same-time collisions between tenants.
ALTER TABLE analysis_runs DROP CONSTRAINT IF EXISTS analysis_runs_pkey;
ALTER TABLE analysis_runs ADD PRIMARY KEY (scope_key,analysis_id,created_at);
ALTER TABLE agent_trace_events DROP CONSTRAINT IF EXISTS agent_trace_events_pkey;
ALTER TABLE agent_trace_events ADD PRIMARY KEY (scope_key,event_id,created_at);
ALTER TABLE evaluation_cases DROP CONSTRAINT IF EXISTS evaluation_cases_pkey;
ALTER TABLE evaluation_cases ADD PRIMARY KEY (scope_key,case_id,created_at);

CREATE INDEX IF NOT EXISTS analysis_scope_identity_created
  ON analysis_runs(scope_key,analysis_id,created_at DESC);
CREATE INDEX IF NOT EXISTS trace_scope_identity_created
  ON agent_trace_events(scope_key,analysis_id,event_id,created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_case_scope_identity_created
  ON evaluation_cases(scope_key,experiment_id,case_id,created_at DESC);

COMMIT;
