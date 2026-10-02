BEGIN;

DROP TRIGGER IF EXISTS agent_test_center_runs_immutable ON agent_test_center_runs;
DROP TRIGGER IF EXISTS agent_test_center_events_immutable ON agent_test_center_events;
DROP TRIGGER IF EXISTS agent_test_center_controls_immutable ON agent_test_center_control_changes;

ALTER TABLE agent_test_center_runs ADD COLUMN IF NOT EXISTS feature_id text;
ALTER TABLE agent_test_center_events ADD COLUMN IF NOT EXISTS feature_id text;
ALTER TABLE agent_test_center_control_changes ADD COLUMN IF NOT EXISTS feature_id text;

UPDATE agent_test_center_runs SET feature_id = 'dependency-safety-envelope'
  WHERE feature_id IS NULL;
UPDATE agent_test_center_events SET feature_id = 'dependency-safety-envelope'
  WHERE feature_id IS NULL;
UPDATE agent_test_center_control_changes SET feature_id = 'dependency-safety-envelope'
  WHERE feature_id IS NULL;

ALTER TABLE agent_test_center_runs ALTER COLUMN feature_id SET NOT NULL;
ALTER TABLE agent_test_center_events ALTER COLUMN feature_id SET NOT NULL;
ALTER TABLE agent_test_center_control_changes ALTER COLUMN feature_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_center_runs_feature_id_check'
    AND conrelid = 'agent_test_center_runs'::regclass) THEN
    ALTER TABLE agent_test_center_runs ADD CONSTRAINT agent_test_center_runs_feature_id_check
      CHECK (feature_id ~ '^[a-z0-9][a-z0-9-]{2,79}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_center_events_feature_id_check'
    AND conrelid = 'agent_test_center_events'::regclass) THEN
    ALTER TABLE agent_test_center_events ADD CONSTRAINT agent_test_center_events_feature_id_check
      CHECK (feature_id ~ '^[a-z0-9][a-z0-9-]{2,79}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_center_controls_feature_id_check'
    AND conrelid = 'agent_test_center_control_changes'::regclass) THEN
    ALTER TABLE agent_test_center_control_changes ADD CONSTRAINT agent_test_center_controls_feature_id_check
      CHECK (feature_id ~ '^[a-z0-9][a-z0-9-]{2,79}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_test_center_runs_feature_created
  ON agent_test_center_runs (feature_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recovery_artifacts (
  artifact_id text PRIMARY KEY,
  artifact_kind text NOT NULL CHECK (artifact_kind ~ '^[a-z_]{3,64}$'),
  run_id text NOT NULL CHECK (run_id ~ '^run-[a-f0-9]{32}$'),
  scope_key text NOT NULL CHECK (scope_key ~ '^tenant_[a-f0-9]{16}$'),
  domain_id text,
  produced_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 80),
  canonical_hash text NOT NULL CHECK (canonical_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_hash),
  UNIQUE (artifact_kind, idempotency_key)
);

CREATE TABLE IF NOT EXISTS recovery_run_events (
  event_id text PRIMARY KEY,
  run_id text NOT NULL CHECK (run_id ~ '^run-[a-f0-9]{32}$'),
  sequence integer NOT NULL CHECK (sequence > 0),
  state text NOT NULL CHECK (state IN ('planned','evidence_captured','point_set_frozen',
    'restore_started','restore_verified','reconciling','evaluated','read_only_ready','blocked','closed')),
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='recovery_artifacts_domain_id_check'
    AND conrelid='recovery_artifacts'::regclass) THEN
    ALTER TABLE recovery_artifacts ADD CONSTRAINT recovery_artifacts_domain_id_check
      CHECK (domain_id IS NULL OR domain_id IN ('convex_product_state','timescale_history',
        'temporal_workflows','repository_release','redis_coordination',
        'external_execution_state','non_owner_secret_custody'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS recovery_artifacts_immutable ON recovery_artifacts;
CREATE TRIGGER recovery_artifacts_immutable BEFORE UPDATE OR DELETE ON recovery_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();
DROP TRIGGER IF EXISTS recovery_run_events_immutable ON recovery_run_events;
CREATE TRIGGER recovery_run_events_immutable BEFORE UPDATE OR DELETE ON recovery_run_events
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

DROP TRIGGER IF EXISTS agent_test_center_runs_immutable ON agent_test_center_runs;
CREATE TRIGGER agent_test_center_runs_immutable BEFORE UPDATE OR DELETE ON agent_test_center_runs
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();
DROP TRIGGER IF EXISTS agent_test_center_events_immutable ON agent_test_center_events;
CREATE TRIGGER agent_test_center_events_immutable BEFORE UPDATE OR DELETE ON agent_test_center_events
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();
DROP TRIGGER IF EXISTS agent_test_center_controls_immutable ON agent_test_center_control_changes;
CREATE TRIGGER agent_test_center_controls_immutable BEFORE UPDATE OR DELETE ON agent_test_center_control_changes
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

COMMIT;
