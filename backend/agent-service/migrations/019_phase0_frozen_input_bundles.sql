BEGIN;

ALTER TABLE execution_artifact_decisions ADD COLUMN IF NOT EXISTS input_manifest_hash text;
ALTER TABLE execution_artifact_decisions ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE temporal_safety_decisions ADD COLUMN IF NOT EXISTS registry_hash text;
ALTER TABLE temporal_safety_decisions ADD COLUMN IF NOT EXISTS inventory_hash text;
ALTER TABLE temporal_safety_decisions ADD COLUMN IF NOT EXISTS input_manifest_hash text;
ALTER TABLE temporal_safety_decisions ADD COLUMN IF NOT EXISTS request_hash text;

CREATE TABLE IF NOT EXISTS execution_artifact_input_manifests (
  manifest_hash text PRIMARY KEY CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  scope_key text NOT NULL CHECK (scope_key ~ '^(shared|tenant:[a-z0-9_-]+|account:[a-z0-9_-]+)$'),
  operation text NOT NULL, request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_key, idempotency_key));
CREATE TABLE IF NOT EXISTS temporal_input_manifests (
  manifest_hash text PRIMARY KEY CHECK (manifest_hash ~ '^[a-f0-9]{64}$'), scope_key text NOT NULL,
  operation text NOT NULL, registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'),
  inventory_hash text NOT NULL CHECK (inventory_hash ~ '^[a-f0-9]{64}$'),
  scenario_hash text NOT NULL CHECK (scenario_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'), idempotency_key text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (scope_key, idempotency_key));
CREATE TABLE IF NOT EXISTS execution_artifact_test_center_bundles (
  run_id text PRIMARY KEY REFERENCES agent_test_center_runs(run_id),
  decision_hash text NOT NULL REFERENCES execution_artifact_decisions(decision_hash),
  manifest_hash text NOT NULL REFERENCES execution_artifact_input_manifests(manifest_hash));
CREATE TABLE IF NOT EXISTS temporal_test_center_bundles (
  run_id text PRIMARY KEY REFERENCES agent_test_center_runs(run_id),
  decision_hash text NOT NULL REFERENCES temporal_safety_decisions(decision_hash),
  manifest_hash text NOT NULL REFERENCES temporal_input_manifests(manifest_hash));

CREATE OR REPLACE FUNCTION phase0_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'phase zero frozen input history is immutable'; END $$;
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['execution_artifact_input_manifests','temporal_input_manifests',
    'execution_artifact_test_center_bundles','temporal_test_center_bundles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', item, item);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION phase0_reject_mutation()', item, item);
  END LOOP;
END $$;
COMMIT;
