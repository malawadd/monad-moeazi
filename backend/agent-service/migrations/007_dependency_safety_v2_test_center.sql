CREATE UNIQUE INDEX IF NOT EXISTS safety_decisions_v2_idempotency
  ON safety_envelope_decisions (matrix_version, idempotency_key)
  WHERE matrix_version = 'dependency-safety-v2';

CREATE INDEX IF NOT EXISTS dependency_receipts_owner_current
  ON dependency_health_receipts
  (dependency_id, (scope->>'key'), observed_at DESC, canonical_hash DESC);

CREATE TABLE IF NOT EXISTS agent_test_center_runs (
  run_id text PRIMARY KEY,
  operator_test_id text NOT NULL,
  scenario_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('observe','enforce')),
  repository_sha text NOT NULL CHECK (repository_sha ~ '^[a-f0-9]{40}$'),
  registry_version text NOT NULL,
  registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'),
  control_hash text NOT NULL CHECK (control_hash ~ '^[a-f0-9]{64}$'),
  fixture_hash text NOT NULL CHECK (fixture_hash ~ '^[a-f0-9]{64}$'),
  safe_environment text NOT NULL CHECK (safe_environment IN ('local','test')),
  invariant_verdict text NOT NULL CHECK (invariant_verdict IN ('pass','fail')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_test_center_events (
  event_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_test_center_control_changes (
  change_id text PRIMARY KEY,
  operator_test_id text NOT NULL,
  previous_hash text NOT NULL,
  control_hash text NOT NULL CHECK (control_hash ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL CHECK (revision > 0),
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_test_center_runs_created
  ON agent_test_center_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS agent_test_center_events_run_sequence
  ON agent_test_center_events (run_id, sequence);

DROP TRIGGER IF EXISTS agent_test_center_runs_immutable ON agent_test_center_runs;
CREATE TRIGGER agent_test_center_runs_immutable
  BEFORE UPDATE OR DELETE ON agent_test_center_runs
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

DROP TRIGGER IF EXISTS agent_test_center_events_immutable ON agent_test_center_events;
CREATE TRIGGER agent_test_center_events_immutable
  BEFORE UPDATE OR DELETE ON agent_test_center_events
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

DROP TRIGGER IF EXISTS agent_test_center_controls_immutable ON agent_test_center_control_changes;
CREATE TRIGGER agent_test_center_controls_immutable
  BEFORE UPDATE OR DELETE ON agent_test_center_control_changes
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();
