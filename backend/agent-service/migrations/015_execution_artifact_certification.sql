BEGIN;

CREATE OR REPLACE FUNCTION execution_artifact_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'execution artifact certification history is immutable'; END $$;

CREATE TABLE IF NOT EXISTS execution_artifact_specs (
  spec_hash text PRIMARY KEY CHECK (spec_hash ~ '^[a-f0-9]{64}$'), scope_key text NOT NULL CHECK (scope_key ~ '^(shared|tenant:[a-z0-9_-]+|account:[a-z0-9_-]+)$'),
  artifact_id text NOT NULL, version integer NOT NULL CHECK (version > 0), expires_at timestamptz NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (scope_key,artifact_id,version));
CREATE TABLE IF NOT EXISTS execution_artifact_observations (
  observation_hash text PRIMARY KEY CHECK (observation_hash ~ '^[a-f0-9]{64}$'), spec_hash text NOT NULL REFERENCES execution_artifact_specs(spec_hash),
  scope_key text NOT NULL, artifact_id text NOT NULL, boundary text NOT NULL CHECK (boundary IN ('prepare','sign','dispatch','close','reconcile')),
  expires_at timestamptz NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS execution_artifact_graph_snapshots (
  graph_hash text PRIMARY KEY CHECK (graph_hash ~ '^[a-f0-9]{64}$'), scope_key text NOT NULL, operation text NOT NULL,
  input_manifest_hash text NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS execution_artifact_decisions (
  decision_hash text PRIMARY KEY CHECK (decision_hash ~ '^[a-f0-9]{64}$'), scope_key text NOT NULL CHECK (scope_key ~ '^(shared|tenant:[a-z0-9_-]+|account:[a-z0-9_-]+)$'),
  operation text NOT NULL, outcome text NOT NULL CHECK (outcome IN ('pass','block','close_only','unknown')), graph_hash text NOT NULL REFERENCES execution_artifact_graph_snapshots(graph_hash),
  spec_manifest_hash text NOT NULL CHECK (spec_manifest_hash ~ '^[a-f0-9]{64}$'), observation_manifest_hash text NOT NULL CHECK (observation_manifest_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 96), evaluated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK (expires_at > evaluated_at), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (scope_key,idempotency_key));
CREATE TABLE IF NOT EXISTS execution_artifact_drifts (
  drift_hash text PRIMARY KEY CHECK (drift_hash ~ '^[a-f0-9]{64}$'), scope_key text NOT NULL, artifact_id text NOT NULL, drift_class text NOT NULL,
  current_observation_hash text NOT NULL CHECK (current_observation_hash ~ '^[a-f0-9]{64}$'), state text NOT NULL DEFAULT 'latched' CHECK (state='latched'), invalidation_set_hash text NOT NULL CHECK (invalidation_set_hash ~ '^[a-f0-9]{64}$'), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS execution_artifact_invalidations (
  receipt_hash text PRIMARY KEY CHECK (receipt_hash ~ '^[a-f0-9]{64}$'), drift_hash text NOT NULL REFERENCES execution_artifact_drifts(drift_hash), dependent_kind text NOT NULL CHECK (dependent_kind IN ('route','grant','equivalence','preparation')),
  dependent_id text NOT NULL, predecessor_hash text NOT NULL CHECK (predecessor_hash ~ '^[a-f0-9]{64}$'), state text NOT NULL CHECK (state='invalidated'), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(drift_hash,dependent_kind,dependent_id));
CREATE TABLE IF NOT EXISTS execution_artifact_requalifications (
  decision_hash text PRIMARY KEY CHECK (decision_hash ~ '^[a-f0-9]{64}$'), scope_key text NOT NULL, drift_hash text NOT NULL REFERENCES execution_artifact_drifts(drift_hash),
  predecessor_hash text, outcome text NOT NULL CHECK (outcome IN ('approve','reject')), idempotency_key text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(scope_key,idempotency_key));

CREATE INDEX IF NOT EXISTS execution_artifact_specs_scope_expiry_idx ON execution_artifact_specs(scope_key,expires_at);
CREATE INDEX IF NOT EXISTS execution_artifact_decisions_scope_expiry_idx ON execution_artifact_decisions(scope_key,expires_at);
CREATE INDEX IF NOT EXISTS execution_artifact_drifts_scope_latch_idx ON execution_artifact_drifts(scope_key,state);
CREATE INDEX IF NOT EXISTS execution_artifact_invalidations_dependent_idx ON execution_artifact_invalidations(dependent_kind,dependent_id);
DO $$ DECLARE item text; BEGIN FOREACH item IN ARRAY ARRAY['execution_artifact_specs','execution_artifact_observations','execution_artifact_graph_snapshots','execution_artifact_decisions','execution_artifact_drifts','execution_artifact_invalidations','execution_artifact_requalifications'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', item, item);
  EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION execution_artifact_reject_mutation()', item, item);
END LOOP; END $$;
COMMIT;
