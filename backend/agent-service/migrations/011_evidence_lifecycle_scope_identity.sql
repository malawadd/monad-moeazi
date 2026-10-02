BEGIN;

-- Scope is part of lifecycle identity. Historical rows that cannot be bound
-- unambiguously remain quarantined as legacy_unbound and cannot match runtime scopes.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE signal_reports ADD COLUMN IF NOT EXISTS analysis_id text;
ALTER TABLE signal_reports ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS analysis_id text;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS account_id text;
WITH owners AS (SELECT analysis_id,max(account_id) AS account_id FROM analysis_runs
  GROUP BY analysis_id HAVING count(DISTINCT account_id)=1)
UPDATE signal_reports r SET account_id=o.account_id FROM owners o
 WHERE r.analysis_id=o.analysis_id AND r.account_id IS NULL;
WITH owners AS (SELECT analysis_id,max(account_id) AS account_id FROM analysis_runs
  GROUP BY analysis_id HAVING count(DISTINCT account_id)=1)
UPDATE provider_calls c SET account_id=o.account_id FROM owners o
 WHERE c.analysis_id=o.analysis_id AND c.account_id IS NULL;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['evidence_retention_schedules',
    'evidence_lifecycle_outbox','evidence_lifecycle_commands',
    'evidence_lifecycle_command_outbox','evidence_copy_receipts',
    'evidence_lifecycle_holds','evidence_lifecycle_tombstones'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I',table_name,table_name);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS scope_key text',table_name);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',table_name,
      table_name||'_scope_check');
  END LOOP;
END $$;

UPDATE evidence_retention_schedules SET scope_key=COALESCE(payload->>'scope_key','legacy_unbound')
 WHERE scope_key IS NULL;
UPDATE evidence_lifecycle_outbox o SET scope_key=s.scope_key
 FROM evidence_retention_schedules s WHERE o.schedule_hash=s.schedule_hash AND o.scope_key IS NULL;
UPDATE evidence_lifecycle_commands c SET scope_key=s.scope_key
 FROM evidence_retention_schedules s WHERE c.schedule_hash=s.schedule_hash AND c.scope_key IS NULL;
UPDATE evidence_lifecycle_command_outbox o SET scope_key=s.scope_key
 FROM evidence_retention_schedules s WHERE o.schedule_hash=s.schedule_hash AND o.scope_key IS NULL;
UPDATE evidence_copy_receipts r SET scope_key=s.scope_key
 FROM evidence_retention_schedules s WHERE r.schedule_hash=s.schedule_hash AND r.scope_key IS NULL;
UPDATE evidence_lifecycle_holds SET scope_key=COALESCE(payload->>'scope_key','legacy_unbound')
 WHERE scope_key IS NULL;
UPDATE evidence_lifecycle_tombstones SET scope_key=COALESCE(payload->>'scope_key','legacy_unbound')
 WHERE scope_key IS NULL;

ALTER TABLE evidence_retention_schedules ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evidence_lifecycle_outbox ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evidence_lifecycle_commands ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evidence_lifecycle_command_outbox ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evidence_copy_receipts ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evidence_lifecycle_holds ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evidence_lifecycle_tombstones ALTER COLUMN scope_key SET NOT NULL;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['evidence_retention_schedules',
    'evidence_lifecycle_outbox','evidence_lifecycle_commands',
    'evidence_lifecycle_command_outbox','evidence_copy_receipts',
    'evidence_lifecycle_holds','evidence_lifecycle_tombstones'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK '
      '(scope_key=''public'' OR scope_key=''legacy_unbound'' '
      'OR scope_key ~ ''^(account|tenant):[^:]{1,120}$'')',table_name,
      table_name||'_scope_check');
  END LOOP;
END $$;

ALTER TABLE evidence_lifecycle_outbox DROP CONSTRAINT IF EXISTS evidence_lifecycle_outbox_schedule_scope_fk;
ALTER TABLE evidence_lifecycle_commands DROP CONSTRAINT IF EXISTS evidence_lifecycle_commands_schedule_scope_fk;
ALTER TABLE evidence_lifecycle_command_outbox DROP CONSTRAINT IF EXISTS evidence_lifecycle_command_outbox_schedule_scope_fk;
ALTER TABLE evidence_copy_receipts DROP CONSTRAINT IF EXISTS evidence_copy_receipts_schedule_scope_fk;
ALTER TABLE evidence_retention_schedules
  DROP CONSTRAINT IF EXISTS evidence_retention_schedule_hash_scope;
ALTER TABLE evidence_retention_schedules
  ADD CONSTRAINT evidence_retention_schedule_hash_scope UNIQUE (schedule_hash,scope_key);
ALTER TABLE evidence_lifecycle_decisions
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_decisions_producer_sink_idempotency_key_key;
ALTER TABLE evidence_lifecycle_decisions
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_decision_scope_idempotency;
ALTER TABLE evidence_lifecycle_decisions ADD CONSTRAINT
  evidence_lifecycle_decision_scope_idempotency
  UNIQUE (producer,sink,scope_key,idempotency_key);
ALTER TABLE evidence_lifecycle_commands DROP CONSTRAINT IF EXISTS evidence_lifecycle_commands_schedule_fk;
ALTER TABLE evidence_lifecycle_command_outbox DROP CONSTRAINT IF EXISTS evidence_lifecycle_command_outbox_schedule_fk;
ALTER TABLE evidence_copy_receipts DROP CONSTRAINT IF EXISTS evidence_copy_receipts_schedule_fk;
ALTER TABLE evidence_lifecycle_outbox DROP CONSTRAINT IF EXISTS evidence_lifecycle_outbox_schedule_hash_fkey;
ALTER TABLE evidence_lifecycle_outbox DROP CONSTRAINT IF EXISTS evidence_lifecycle_outbox_schedule_scope_fk;
ALTER TABLE evidence_lifecycle_commands DROP CONSTRAINT IF EXISTS evidence_lifecycle_commands_schedule_scope_fk;
ALTER TABLE evidence_lifecycle_command_outbox DROP CONSTRAINT IF EXISTS evidence_lifecycle_command_outbox_schedule_scope_fk;
ALTER TABLE evidence_copy_receipts DROP CONSTRAINT IF EXISTS evidence_copy_receipts_schedule_scope_fk;
ALTER TABLE evidence_lifecycle_outbox ADD CONSTRAINT evidence_lifecycle_outbox_schedule_scope_fk
  FOREIGN KEY (schedule_hash,scope_key)
  REFERENCES evidence_retention_schedules(schedule_hash,scope_key);
ALTER TABLE evidence_lifecycle_commands ADD CONSTRAINT evidence_lifecycle_commands_schedule_scope_fk
  FOREIGN KEY (schedule_hash,scope_key)
  REFERENCES evidence_retention_schedules(schedule_hash,scope_key);
ALTER TABLE evidence_lifecycle_command_outbox ADD CONSTRAINT evidence_lifecycle_command_outbox_schedule_scope_fk
  FOREIGN KEY (schedule_hash,scope_key)
  REFERENCES evidence_retention_schedules(schedule_hash,scope_key);
ALTER TABLE evidence_copy_receipts ADD CONSTRAINT evidence_copy_receipts_schedule_scope_fk
  FOREIGN KEY (schedule_hash,scope_key)
  REFERENCES evidence_retention_schedules(schedule_hash,scope_key);

ALTER TABLE evidence_lifecycle_command_outbox
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_command_outbox_artifact_id_schedule_hash_copy_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_lifecycle_command_outbox_scope_copy
  ON evidence_lifecycle_command_outbox(scope_key,artifact_id,schedule_hash,copy_id);
ALTER TABLE evidence_lifecycle_commands
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_commands_owner_id_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_lifecycle_command_scope_idempotency
  ON evidence_lifecycle_commands(scope_key,owner_id,idempotency_key);
DROP INDEX IF EXISTS evidence_copy_schedule_revision;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_copy_scope_schedule_revision
  ON evidence_copy_receipts(scope_key,artifact_id,schedule_hash,copy_id,revision);
ALTER TABLE evidence_lifecycle_holds
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_holds_artifact_id_revision_key;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_lifecycle_hold_scope_revision
  ON evidence_lifecycle_holds(scope_key,artifact_id,revision);
ALTER TABLE evidence_lifecycle_hold_outbox
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_hold_outbox_hold_scope_fk;
ALTER TABLE evidence_lifecycle_holds
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_hold_hash_scope;
ALTER TABLE evidence_lifecycle_holds
  ADD CONSTRAINT evidence_lifecycle_hold_hash_scope UNIQUE (hold_hash,scope_key);
ALTER TABLE evidence_lifecycle_hold_outbox
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_hold_outbox_hold_hash_fkey;
ALTER TABLE evidence_lifecycle_hold_outbox
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_hold_outbox_hold_scope_fk;
ALTER TABLE evidence_lifecycle_hold_outbox ADD CONSTRAINT
  evidence_lifecycle_hold_outbox_hold_scope_fk FOREIGN KEY (hold_hash,scope_key)
  REFERENCES evidence_lifecycle_holds(hold_hash,scope_key);
ALTER TABLE evidence_lifecycle_tombstones
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_tombstones_artifact_id_copy_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_lifecycle_tombstone_scope_copy
  ON evidence_lifecycle_tombstones(scope_key,artifact_id,copy_id);
ALTER TABLE evidence_lifecycle_tombstones
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_tombstone_copy_scope_fk;
ALTER TABLE evidence_copy_receipts
  DROP CONSTRAINT IF EXISTS evidence_copy_receipt_hash_scope;
ALTER TABLE evidence_copy_receipts
  ADD CONSTRAINT evidence_copy_receipt_hash_scope UNIQUE (receipt_hash,scope_key);
ALTER TABLE evidence_lifecycle_tombstones
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_tombstone_copy_scope_fk;
ALTER TABLE evidence_lifecycle_tombstones ADD CONSTRAINT
  evidence_lifecycle_tombstone_copy_scope_fk FOREIGN KEY (copy_receipt_hash,scope_key)
  REFERENCES evidence_copy_receipts(receipt_hash,scope_key) NOT VALID;

ALTER TABLE evaluation_case_idempotency ADD COLUMN IF NOT EXISTS scope_key text;
UPDATE evaluation_case_idempotency i SET scope_key=d.scope_key
 FROM evidence_lifecycle_decisions d
 WHERE i.lifecycle_decision_hash=d.decision_hash AND i.scope_key IS NULL;
UPDATE evaluation_case_idempotency SET scope_key='legacy_unbound' WHERE scope_key IS NULL;
ALTER TABLE evaluation_case_idempotency ALTER COLUMN scope_key SET NOT NULL;
ALTER TABLE evaluation_case_idempotency DROP CONSTRAINT IF EXISTS evaluation_case_idempotency_pkey;
ALTER TABLE evaluation_case_idempotency ADD PRIMARY KEY (scope_key,case_id);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['evidence_retention_schedules',
    'evidence_lifecycle_commands','evidence_copy_receipts',
    'evidence_lifecycle_holds','evidence_lifecycle_tombstones'] LOOP
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation()',table_name,table_name);
  END LOOP;
END $$;
COMMIT;
