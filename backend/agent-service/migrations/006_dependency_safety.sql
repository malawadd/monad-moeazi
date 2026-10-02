CREATE TABLE IF NOT EXISTS dependency_health_receipts (
  receipt_id text PRIMARY KEY,
  dependency_id text NOT NULL,
  failure_domain text NOT NULL CHECK (failure_domain IN
    ('execution_critical','authority_critical','evidence_critical','observability_only')),
  scope jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy','degraded','open','unknown','stale')),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reason_code text NOT NULL,
  evidence_reference text,
  source_revision text NOT NULL,
  adapter_version text NOT NULL,
  observation_key text NOT NULL,
  supersedes_receipt_id text,
  canonical_hash text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safety_envelope_decisions (
  decision_id text PRIMARY KEY,
  matrix_version text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('observe','enforce')),
  operation text NOT NULL,
  subject_key text NOT NULL,
  scope jsonb NOT NULL,
  breaker_state text NOT NULL CHECK (breaker_state IN ('closed','open','half_open','recovering')),
  outcome text NOT NULL CHECK (outcome IN ('allow','block')),
  reasons jsonb NOT NULL,
  receipt_hashes jsonb NOT NULL,
  incident_keys jsonb NOT NULL,
  bindings jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  decision_hash text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dependency_incident_transitions (
  transition_id text PRIMARY KEY,
  incident_key text NOT NULL,
  dependency_id text NOT NULL,
  scope jsonb NOT NULL,
  from_state text,
  to_state text NOT NULL CHECK (to_state IN ('open','half_open','recovering','resolved')),
  receipt_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dependency_receipts_scope_observed
  ON dependency_health_receipts ((scope->>'strategy_account_id'), observed_at DESC);
CREATE INDEX IF NOT EXISTS safety_decisions_scope_operation
  ON safety_envelope_decisions ((scope->>'strategy_account_id'), operation, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS dependency_incidents_key_observed
  ON dependency_incident_transitions (incident_key, observed_at DESC);

CREATE OR REPLACE FUNCTION reject_dependency_safety_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dependency safety history is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dependency_receipts_immutable ON dependency_health_receipts;
CREATE TRIGGER dependency_receipts_immutable
  BEFORE UPDATE OR DELETE ON dependency_health_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

DROP TRIGGER IF EXISTS safety_decisions_immutable ON safety_envelope_decisions;
CREATE TRIGGER safety_decisions_immutable
  BEFORE UPDATE OR DELETE ON safety_envelope_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

DROP TRIGGER IF EXISTS dependency_incident_transitions_immutable
  ON dependency_incident_transitions;
CREATE TRIGGER dependency_incident_transitions_immutable
  BEFORE UPDATE OR DELETE ON dependency_incident_transitions
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();
