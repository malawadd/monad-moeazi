BEGIN;
ALTER TABLE evidence ALTER COLUMN sanitized_content DROP NOT NULL;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS lifecycle_decision_hash text;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS lifecycle_policy_hash text;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'legacy_unclassified';
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS body_expires_at timestamptz;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS lifecycle_decision_hash text;
ALTER TABLE signal_reports ADD COLUMN IF NOT EXISTS lifecycle_decision_hash text;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS lifecycle_decision_hash text;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS body_expires_at timestamptz;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS lifecycle_deleted_at timestamptz;
ALTER TABLE signal_reports ADD COLUMN IF NOT EXISTS lifecycle_deleted_at timestamptz;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS lifecycle_deleted_at timestamptz;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS lifecycle_decision_hash text;
ALTER TABLE agent_trace_events ADD COLUMN IF NOT EXISTS lifecycle_deleted_at timestamptz;
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS lifecycle_decision_hash text;
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS lifecycle_deleted_at timestamptz;
ALTER TABLE evaluation_cases ADD COLUMN IF NOT EXISTS lifecycle_decision_hash text;
ALTER TABLE evaluation_cases ADD COLUMN IF NOT EXISTS body_expires_at timestamptz;
ALTER TABLE evaluation_cases ADD COLUMN IF NOT EXISTS lifecycle_deleted_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='evidence_lifecycle_state_check'
    AND conrelid='evidence'::regclass) THEN
    ALTER TABLE evidence ADD CONSTRAINT evidence_lifecycle_state_check
      CHECK (lifecycle_state IN ('legacy_unclassified','governed','quarantined','deleted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='evidence_lifecycle_hashes_check'
    AND conrelid='evidence'::regclass) THEN
    ALTER TABLE evidence ADD CONSTRAINT evidence_lifecycle_hashes_check CHECK (
      (lifecycle_state='legacy_unclassified' AND lifecycle_decision_hash IS NULL)
      OR (lifecycle_state<>'legacy_unclassified'
        AND lifecycle_decision_hash ~ '^[a-f0-9]{64}$'
        AND lifecycle_policy_hash ~ '^[a-f0-9]{64}$'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS evidence_lifecycle_decisions (
  decision_id text PRIMARY KEY CHECK (decision_id ~ '^eld_[a-f0-9]{48}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  decision_hash text NOT NULL UNIQUE CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  producer text NOT NULL CHECK (producer ~ '^[a-z0-9_]{3,64}$'),
  purpose text NOT NULL CHECK (purpose ~ '^[a-z0-9_]{3,64}$'),
  sink text NOT NULL CHECK (sink ~ '^[a-z0-9_.]{3,96}$'),
  scope_kind text NOT NULL CHECK (scope_kind IN ('public','tenant','account')),
  scope_key text NOT NULL,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  inventory_hash text NOT NULL CHECK (inventory_hash ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('allow','transformed','drop','quarantine','block','unknown')),
  reasons jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > evaluated_at),
  admitted_payload_hash text CHECK (admitted_payload_hash IS NULL OR admitted_payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producer,sink,idempotency_key)
);
ALTER TABLE evidence_lifecycle_decisions ADD COLUMN IF NOT EXISTS admitted_payload_hash text;
CREATE TABLE IF NOT EXISTS evidence_transform_receipts (
  receipt_id text PRIMARY KEY CHECK (receipt_id ~ '^etr_[a-f0-9]{48}$'),
  decision_id text NOT NULL REFERENCES evidence_lifecycle_decisions(decision_id),
  receipt_hash text NOT NULL UNIQUE CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  path text NOT NULL,
  data_class text NOT NULL CHECK (data_class IN ('prohibited','secret','personal','linkable',
    'financial','customer_confidential','internal','public','safety_root')),
  outcome text NOT NULL CHECK (outcome IN ('retained','dropped','normalized','truncated')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evidence_retention_schedules (
  schedule_id text PRIMARY KEY CHECK (schedule_id ~ '^ers_[a-f0-9]{48}$'),
  artifact_id text NOT NULL,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  schedule_hash text NOT NULL UNIQUE CHECK (schedule_hash ~ '^[a-f0-9]{64}$'),
  body_expires_at timestamptz NOT NULL,
  expected_copies jsonb NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evidence_lifecycle_outbox (
  schedule_hash text PRIMARY KEY REFERENCES evidence_retention_schedules(schedule_hash),
  artifact_id text NOT NULL,
  due_at timestamptz NOT NULL,
  expected_copies jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evidence_lifecycle_commands (
  command_id text PRIMARY KEY CHECK (command_id ~ '^elc_[a-f0-9]{48}$'),
  artifact_id text NOT NULL,
  schedule_hash text NOT NULL CONSTRAINT evidence_lifecycle_commands_schedule_fk
    REFERENCES evidence_retention_schedules(schedule_hash),
  owner_id text NOT NULL,
  copy_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  command_hash text NOT NULL UNIQUE CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id,idempotency_key)
);
DROP TRIGGER IF EXISTS evidence_lifecycle_commands_immutable ON evidence_lifecycle_commands;
ALTER TABLE evidence_lifecycle_commands ADD COLUMN IF NOT EXISTS schedule_hash text;
CREATE TABLE IF NOT EXISTS evidence_lifecycle_command_outbox (
  command_hash text PRIMARY KEY REFERENCES evidence_lifecycle_commands(command_hash),
  command_id text NOT NULL,
  artifact_id text NOT NULL,
  schedule_hash text NOT NULL CONSTRAINT evidence_lifecycle_command_outbox_schedule_fk
    REFERENCES evidence_retention_schedules(schedule_hash),
  copy_id text NOT NULL,
  owner_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  terminal_status text,
  receipt_hash text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id,schedule_hash,copy_id)
);
UPDATE evidence_lifecycle_commands c SET schedule_hash=COALESCE(c.schedule_hash,
  c.payload->>'schedule_hash', (SELECT o.schedule_hash
    FROM evidence_lifecycle_command_outbox o WHERE o.command_hash=c.command_hash LIMIT 1))
WHERE c.schedule_hash IS NULL;
ALTER TABLE evidence_lifecycle_commands ALTER COLUMN schedule_hash SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='evidence_lifecycle_commands_schedule_fk'
        AND conrelid='evidence_lifecycle_commands'::regclass) THEN
    ALTER TABLE evidence_lifecycle_commands ADD CONSTRAINT
      evidence_lifecycle_commands_schedule_fk FOREIGN KEY (schedule_hash)
      REFERENCES evidence_retention_schedules(schedule_hash);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='evidence_lifecycle_command_outbox_schedule_fk'
        AND conrelid='evidence_lifecycle_command_outbox'::regclass) THEN
    ALTER TABLE evidence_lifecycle_command_outbox ADD CONSTRAINT
      evidence_lifecycle_command_outbox_schedule_fk FOREIGN KEY (schedule_hash)
      REFERENCES evidence_retention_schedules(schedule_hash);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS evidence_copy_receipts (
  receipt_id text PRIMARY KEY CHECK (receipt_id ~ '^ecd_[a-f0-9]{48}$'),
  artifact_id text NOT NULL,
  schedule_hash text NOT NULL CONSTRAINT evidence_copy_receipts_schedule_fk
    REFERENCES evidence_retention_schedules(schedule_hash),
  copy_id text NOT NULL,
  owner_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  predecessor_hash text,
  receipt_hash text NOT NULL UNIQUE CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('verified_logical','verified_physical','crypto_erased',
    'retained_hold','provider_reported','pending','partial','unverifiable','public_onchain',
    'not_applicable')),
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id,schedule_hash,copy_id,revision)
);
DROP TRIGGER IF EXISTS evidence_copy_receipts_immutable ON evidence_copy_receipts;
ALTER TABLE evidence_copy_receipts ADD COLUMN IF NOT EXISTS schedule_hash text;
CREATE TABLE IF NOT EXISTS evidence_legacy_copy_receipts (
  legacy_receipt_hash text PRIMARY KEY, artifact_id text NOT NULL, copy_id text NOT NULL,
  payload jsonb NOT NULL, quarantine_reason text NOT NULL
    CHECK (quarantine_reason='legacy_unbound_schedule'), quarantined_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO evidence_legacy_copy_receipts
  (legacy_receipt_hash,artifact_id,copy_id,payload,quarantine_reason)
SELECT receipt_hash,artifact_id,copy_id,payload,'legacy_unbound_schedule'
FROM evidence_copy_receipts WHERE schedule_hash IS NULL
ON CONFLICT (legacy_receipt_hash) DO NOTHING;
DELETE FROM evidence_copy_receipts WHERE schedule_hash IS NULL;
ALTER TABLE evidence_copy_receipts ALTER COLUMN schedule_hash SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='evidence_copy_receipts_schedule_fk'
        AND conrelid='evidence_copy_receipts'::regclass) THEN
    ALTER TABLE evidence_copy_receipts ADD CONSTRAINT
      evidence_copy_receipts_schedule_fk FOREIGN KEY (schedule_hash)
      REFERENCES evidence_retention_schedules(schedule_hash);
  END IF;
END $$;
ALTER TABLE evidence_copy_receipts
  DROP CONSTRAINT IF EXISTS evidence_copy_receipts_artifact_id_copy_id_revision_key;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_copy_schedule_revision
  ON evidence_copy_receipts(artifact_id,schedule_hash,copy_id,revision);
CREATE TABLE IF NOT EXISTS evidence_lifecycle_holds (
  hold_id text PRIMARY KEY CHECK (hold_id ~ '^elh_[a-f0-9]{48}$'),
  artifact_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  hold_hash text NOT NULL UNIQUE CHECK (hold_hash ~ '^[a-f0-9]{64}$'),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id,revision)
);
CREATE TABLE IF NOT EXISTS evidence_lifecycle_hold_outbox (
  hold_hash text PRIMARY KEY REFERENCES evidence_lifecycle_holds(hold_hash),
  artifact_id text NOT NULL,
  scope_key text NOT NULL,
  due_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  transition_hash text,
  projected_at timestamptz,
  dispatched_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE evidence_lifecycle_hold_outbox ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE evidence_lifecycle_hold_outbox ADD COLUMN IF NOT EXISTS transition_hash text;
ALTER TABLE evidence_lifecycle_hold_outbox ADD COLUMN IF NOT EXISTS projected_at timestamptz;
ALTER TABLE evidence_lifecycle_hold_outbox ADD COLUMN IF NOT EXISTS last_error_code text;
CREATE TABLE IF NOT EXISTS evidence_lifecycle_tombstones (
  tombstone_id text PRIMARY KEY CHECK (tombstone_id ~ '^elt_[a-f0-9]{48}$'),
  artifact_id text NOT NULL,
  copy_id text NOT NULL,
  tombstone_hash text NOT NULL UNIQUE CHECK (tombstone_hash ~ '^[a-f0-9]{64}$'),
  cutoff_at timestamptz NOT NULL,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  inventory_hash text NOT NULL CHECK (inventory_hash ~ '^[a-f0-9]{64}$'),
  copy_receipt_hash text NOT NULL CHECK (copy_receipt_hash ~ '^[a-f0-9]{64}$'),
  body_present boolean NOT NULL DEFAULT false CHECK (body_present=false),
  payload jsonb NOT NULL CHECK (NOT (payload ? 'body')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id,copy_id)
);
ALTER TABLE evidence_lifecycle_tombstones ADD COLUMN IF NOT EXISTS policy_hash text;
ALTER TABLE evidence_lifecycle_tombstones ADD COLUMN IF NOT EXISTS inventory_hash text;
ALTER TABLE evidence_lifecycle_tombstones ADD COLUMN IF NOT EXISTS copy_receipt_hash text;
ALTER TABLE evidence_lifecycle_tombstones ADD COLUMN IF NOT EXISTS body_present boolean NOT NULL DEFAULT false;
UPDATE evidence_lifecycle_tombstones SET
  policy_hash=COALESCE(policy_hash,payload->>'policy_hash'),
  inventory_hash=COALESCE(inventory_hash,payload->>'inventory_hash'),
  copy_receipt_hash=COALESCE(copy_receipt_hash,payload->>'copy_receipt_hash')
WHERE policy_hash IS NULL OR inventory_hash IS NULL OR copy_receipt_hash IS NULL;
CREATE TABLE IF NOT EXISTS evidence_lifecycle_operation_receipts (
  receipt_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  scope_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('access','export','hold','delete')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  receipt_hash text NOT NULL UNIQUE CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE evidence_lifecycle_operation_receipts ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE evidence_lifecycle_operation_receipts ADD COLUMN IF NOT EXISTS request_hash text;
DROP TRIGGER IF EXISTS evidence_lifecycle_operation_receipts_immutable
  ON evidence_lifecycle_operation_receipts;
UPDATE evidence_lifecycle_operation_receipts SET payload=jsonb_build_object('receipt',
  CASE WHEN jsonb_typeof(payload->'receipt')='object'
    THEN (payload->'receipt') - 'output' - 'content'
    ELSE payload - 'output' - 'content' END)
WHERE operation IN ('access','export');
UPDATE evidence_lifecycle_operation_receipts SET
  idempotency_key=COALESCE(idempotency_key,payload->>'idempotency_key',
    payload->'receipt'->>'idempotency_key','legacy:'||receipt_id),
  request_hash=COALESCE(request_hash,payload->>'request_hash',
    payload->'receipt'->>'request_hash',receipt_hash)
WHERE idempotency_key IS NULL OR request_hash IS NULL;
ALTER TABLE evidence_lifecycle_operation_receipts ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE evidence_lifecycle_operation_receipts ALTER COLUMN request_hash SET NOT NULL;
DROP INDEX IF EXISTS evidence_lifecycle_operation_idempotency;
CREATE UNIQUE INDEX evidence_lifecycle_operation_idempotency
  ON evidence_lifecycle_operation_receipts(scope_key,operation,idempotency_key);
CREATE TABLE IF NOT EXISTS evaluation_case_idempotency (
  case_id text PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  lifecycle_decision_hash text NOT NULL CHECK (lifecycle_decision_hash ~ '^[a-f0-9]{64}$'),
  body_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_lifecycle_scope_time
  ON evidence_lifecycle_decisions(scope_key,evaluated_at DESC);
CREATE INDEX IF NOT EXISTS evidence_lifecycle_due
  ON evidence(lifecycle_state,body_expires_at) WHERE sanitized_content IS NOT NULL;
DROP INDEX IF EXISTS evidence_copy_current;
CREATE INDEX evidence_copy_current
  ON evidence_copy_receipts(artifact_id,schedule_hash,copy_id,revision DESC);
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['evidence_lifecycle_decisions','evidence_transform_receipts',
    'evidence_retention_schedules','evidence_lifecycle_commands','evidence_copy_receipts',
    'evidence_lifecycle_holds','evidence_lifecycle_tombstones',
    'evidence_lifecycle_operation_receipts','evidence_legacy_copy_receipts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I',table_name,table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation()',table_name,table_name);
  END LOOP;
END $$;
COMMIT;
