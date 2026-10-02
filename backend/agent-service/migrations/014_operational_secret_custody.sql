BEGIN;

CREATE TABLE IF NOT EXISTS operational_secret_access_decisions (
  decision_id text PRIMARY KEY CHECK (decision_id ~ '^osd_[a-f0-9]{48}$'),
  tenant_scope text NOT NULL CHECK (tenant_scope ~ '^tenant_[a-f0-9]{16}:account_[a-f0-9]{16}$'),
  descriptor_id text NOT NULL CHECK (descriptor_id ~ '^osc_[a-f0-9]{48}$'),
  class_id text NOT NULL,
  purpose text NOT NULL,
  consumer_id text NOT NULL CHECK (consumer_id ~ '^[a-z][a-z0-9_]{2,63}$'),
  consumer_version text NOT NULL CHECK (consumer_version ~ '^v[1-9][0-9]*$'),
  capability text NOT NULL,
  envelope_version integer NOT NULL CHECK (envelope_version > 0),
  aad_hash text NOT NULL CHECK (aad_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  descriptor_hash text NOT NULL CHECK (descriptor_hash ~ '^[a-f0-9]{64}$'),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^[a-f0-9]{64}$'),
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  workload_registry_hash text NOT NULL CHECK (workload_registry_hash ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('allow','block')),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  decided_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > decided_at),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 96),
  decision_hash text NOT NULL UNIQUE CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, idempotency_key),
  UNIQUE (tenant_scope, descriptor_id, request_hash)
);

CREATE TABLE IF NOT EXISTS operational_secret_access_receipts (
  receipt_id text PRIMARY KEY CHECK (receipt_id ~ '^osr_[a-f0-9]{48}$'),
  tenant_scope text NOT NULL,
  descriptor_id text NOT NULL,
  class_id text NOT NULL,
  purpose text NOT NULL,
  consumer_id text NOT NULL,
  consumer_version text NOT NULL,
  capability text NOT NULL,
  envelope_version integer NOT NULL CHECK (envelope_version > 0),
  aad_hash text NOT NULL CHECK (aad_hash ~ '^[a-f0-9]{64}$'),
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  decision_hash text NOT NULL REFERENCES operational_secret_access_decisions(decision_hash),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 96),
  stage text NOT NULL CHECK (stage IN ('authorized_attempt','terminal')),
  outcome text NOT NULL CHECK (outcome IN ('authorized','completed','blocked','callback_failed')),
  reason text NOT NULL,
  sequence smallint NOT NULL CHECK (sequence IN (1,2)),
  occurred_at timestamptz NOT NULL,
  receipt_hash text NOT NULL UNIQUE CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_hash, sequence),
  UNIQUE (tenant_scope, idempotency_key, sequence)
);

CREATE TABLE IF NOT EXISTS operational_secret_lifecycle_decisions (
  decision_id text PRIMARY KEY,
  tenant_scope text NOT NULL,
  descriptor_id text,
  operation text NOT NULL CHECK (operation IN ('inventory','admit','access','rotate','recover',
    'revoke','destroy_plan','readiness_assess','migration_classify')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  predecessor_hash text CHECK (predecessor_hash IS NULL OR predecessor_hash ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('allow','block','incomplete')),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 96),
  occurred_at timestamptz NOT NULL,
  decision_hash text NOT NULL UNIQUE CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operational_secret_lifecycle_receipts (
  receipt_id text PRIMARY KEY,
  tenant_scope text NOT NULL,
  descriptor_id text,
  decision_hash text NOT NULL,
  predecessor_hash text,
  sequence integer NOT NULL CHECK (sequence > 0),
  state text NOT NULL,
  local_status text NOT NULL,
  upstream_status text NOT NULL CHECK (upstream_status IN ('unknown','provider_reported','not_applicable')),
  occurred_at timestamptz NOT NULL,
  receipt_hash text NOT NULL UNIQUE CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, descriptor_id, sequence),
  UNIQUE (tenant_scope, predecessor_hash, receipt_hash)
);

CREATE TABLE IF NOT EXISTS operational_secret_readiness_assessments (
  assessment_id text PRIMARY KEY,
  tenant_scope text NOT NULL,
  registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'),
  dependency_inventory_hash text NOT NULL CHECK (dependency_inventory_hash ~ '^[a-f0-9]{64}$'),
  inventory_hash text NOT NULL CHECK (inventory_hash ~ '^[a-f0-9]{64}$'),
  receipt_chain_hash text NOT NULL CHECK (receipt_chain_hash ~ '^[a-f0-9]{64}$'),
  local_fixture_outcome text NOT NULL CHECK (local_fixture_outcome IN ('ready','blocked')),
  product_outcome text NOT NULL CHECK (product_outcome = 'unavailable'),
  reasons jsonb NOT NULL,
  assessed_at timestamptz NOT NULL,
  assessment_hash text NOT NULL UNIQUE CHECK (assessment_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operational_secret_legacy_inventory (
  inventory_id text PRIMARY KEY,
  tenant_scope text NOT NULL,
  fixture_id text NOT NULL,
  source_store text NOT NULL CHECK (source_store IN ('timescale','convex','environment')),
  shape_hash text NOT NULL CHECK (shape_hash ~ '^[a-f0-9]{64}$'),
  disposition text NOT NULL CHECK (disposition IN ('eligible_pending_reentry',
    'eligible_pending_reissue','eligible_pending_rewrap','quarantine_owner_equivalent',
    'quarantine_unknown','forbidden')),
  capability_status text NOT NULL CHECK (capability_status IN ('disabled','unchanged')),
  observed_at timestamptz NOT NULL,
  inventory_hash text NOT NULL UNIQUE CHECK (inventory_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, fixture_id, inventory_hash)
);

CREATE TABLE IF NOT EXISTS operational_secret_workflow_commands (
  command_id text PRIMARY KEY,
  tenant_scope text NOT NULL,
  descriptor_id text NOT NULL,
  operation text NOT NULL,
  target_versions_hash text NOT NULL CHECK (target_versions_hash ~ '^[a-f0-9]{64}$'),
  registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'),
  control_hash text NOT NULL CHECK (control_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 96),
  status text NOT NULL CHECK (status IN ('pending','claimed','complete','failed_uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, idempotency_key),
  UNIQUE (tenant_scope, descriptor_id, request_hash)
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['operational_secret_access_decisions',
    'operational_secret_access_receipts','operational_secret_lifecycle_decisions',
    'operational_secret_lifecycle_receipts','operational_secret_readiness_assessments',
    'operational_secret_legacy_inventory'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation()', table_name, table_name);
  END LOOP;
END $$;

COMMIT;
