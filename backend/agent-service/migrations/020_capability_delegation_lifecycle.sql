BEGIN;
CREATE OR REPLACE FUNCTION capability_delegation_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'capability delegation history is immutable'; END $$;
CREATE TABLE IF NOT EXISTS capability_grant_specs (
  grant_hash text PRIMARY KEY CHECK(grant_hash ~ '^[a-f0-9]{64}$'), tenant_id text NOT NULL, account_id text NOT NULL,
  scope_key text NOT NULL, grant_id text NOT NULL, grant_type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id, account_id, grant_id, grant_hash));
CREATE TABLE IF NOT EXISTS capability_state_observations (
  observation_hash text PRIMARY KEY CHECK(observation_hash ~ '^[a-f0-9]{64}$'), grant_hash text NOT NULL REFERENCES capability_grant_specs(grant_hash),
  tenant_id text NOT NULL, account_id text NOT NULL, scope_key text NOT NULL, state text NOT NULL, expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS capability_input_manifests (
  manifest_hash text PRIMARY KEY CHECK(manifest_hash ~ '^[a-f0-9]{64}$'), tenant_id text NOT NULL, account_id text NOT NULL,
  scope_key text NOT NULL, operation text NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, account_id, scope_key, idempotency_key));
CREATE TABLE IF NOT EXISTS capability_lifecycle_transitions (
  transition_hash text PRIMARY KEY CHECK(transition_hash ~ '^[a-f0-9]{64}$'), grant_hash text NOT NULL REFERENCES capability_grant_specs(grant_hash),
  sequence bigint NOT NULL CHECK(sequence > 0), predecessor_hash text, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(grant_hash, sequence));
CREATE TABLE IF NOT EXISTS capability_decisions (
  decision_hash text PRIMARY KEY CHECK(decision_hash ~ '^[a-f0-9]{64}$'), tenant_id text NOT NULL, account_id text NOT NULL, scope_key text NOT NULL,
  operation text NOT NULL, outcome text NOT NULL, manifest_hash text NOT NULL REFERENCES capability_input_manifests(manifest_hash),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), idempotency_key text NOT NULL, expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id, account_id, scope_key, idempotency_key));
CREATE TABLE IF NOT EXISTS capability_revocation_plans (
  plan_hash text PRIMARY KEY CHECK(plan_hash ~ '^[a-f0-9]{64}$'), tenant_id text NOT NULL, account_id text NOT NULL, scope_key text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS capability_revocation_receipts (
  receipt_hash text PRIMARY KEY CHECK(receipt_hash ~ '^[a-f0-9]{64}$'), plan_hash text NOT NULL REFERENCES capability_revocation_plans(plan_hash),
  tenant_id text NOT NULL, account_id text NOT NULL, scope_key text NOT NULL, state text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS capability_projection_transitions (
  transition_hash text PRIMARY KEY CHECK(transition_hash ~ '^[a-f0-9]{64}$'), tenant_id text NOT NULL, account_id text NOT NULL,
  scope_key text NOT NULL, sequence bigint NOT NULL CHECK(sequence > 0), predecessor_hash text, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id, account_id, scope_key, sequence));
CREATE TABLE IF NOT EXISTS capability_test_center_bundles (
  run_id text PRIMARY KEY REFERENCES agent_test_center_runs(run_id), manifest_hash text NOT NULL REFERENCES capability_input_manifests(manifest_hash),
  decision_hash text NOT NULL REFERENCES capability_decisions(decision_hash), lifecycle_head_hash text, created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['capability_grant_specs','capability_state_observations','capability_input_manifests','capability_lifecycle_transitions','capability_decisions','capability_revocation_plans','capability_revocation_receipts','capability_projection_transitions','capability_test_center_bundles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', item, item);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capability_delegation_reject_mutation()', item, item);
  END LOOP;
END $$;
COMMIT;
