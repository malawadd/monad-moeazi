\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS migration_010_fixture CASCADE;
CREATE SCHEMA migration_010_fixture;
SET search_path TO migration_010_fixture, public;

CREATE FUNCTION reject_dependency_safety_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;

CREATE TABLE evidence (
  evidence_id text PRIMARY KEY, source text NOT NULL, reference text NOT NULL,
  observed_at timestamptz NOT NULL, event_at timestamptz,
  quality_score double precision NOT NULL, content_hash text NOT NULL,
  sanitized_content text NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE analysis_runs (analysis_id text, scope text NOT NULL DEFAULT 'private',
  account_id text, synthesis jsonb NOT NULL DEFAULT '{}', created_at timestamptz,
  PRIMARY KEY(analysis_id,created_at));
CREATE TABLE signal_reports (report_id bigserial PRIMARY KEY);
CREATE TABLE provider_calls (call_id bigserial PRIMARY KEY);
CREATE TABLE agent_trace_events (
  event_id text NOT NULL, analysis_id text NOT NULL, account_id text,
  input_summary jsonb NOT NULL DEFAULT '{}', output_summary jsonb NOT NULL DEFAULT '{}',
  decision_summary text, error text, created_at timestamptz NOT NULL,
  PRIMARY KEY(event_id,created_at));
CREATE TABLE evaluation_runs (run_id text PRIMARY KEY);
CREATE TABLE evaluation_cases (
  case_id text NOT NULL, experiment_id text NOT NULL, market text NOT NULL,
  case_kind text NOT NULL, repetition integer NOT NULL, market_snapshot jsonb NOT NULL,
  evidence_snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
  observed_at timestamptz NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(case_id,created_at)
);
CREATE TABLE evidence_retention_schedules (
  schedule_id text PRIMARY KEY, artifact_id text NOT NULL, policy_hash text NOT NULL,
  schedule_hash text NOT NULL UNIQUE, body_expires_at timestamptz NOT NULL,
  expected_copies jsonb NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO evidence_retention_schedules VALUES ('ers_'||repeat('1',48),'legacy-artifact',
  repeat('2',64),repeat('3',64),now()+interval '1 hour','[]','{}',now());
CREATE TABLE evidence_lifecycle_commands (
  command_id text PRIMARY KEY, artifact_id text NOT NULL, owner_id text NOT NULL,
  copy_id text NOT NULL, revision integer NOT NULL, command_hash text NOT NULL UNIQUE,
  idempotency_key text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,idempotency_key)
);
INSERT INTO evidence_lifecycle_commands VALUES ('elc_'||repeat('4',48),'legacy-artifact',
  'timescale_history','timescale.analysis_body',1,repeat('5',64),'legacy-command',
  jsonb_build_object('schedule_hash',repeat('3',64)),now());
CREATE TABLE evidence_lifecycle_command_outbox (
  command_hash text PRIMARY KEY, command_id text NOT NULL, artifact_id text NOT NULL,
  schedule_hash text NOT NULL, copy_id text NOT NULL, owner_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, terminal_status text, receipt_hash text, last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(artifact_id,schedule_hash,copy_id)
);
INSERT INTO evidence_lifecycle_command_outbox
  (command_hash,command_id,artifact_id,schedule_hash,copy_id,owner_id)
VALUES (repeat('5',64),'elc_'||repeat('4',48),'legacy-artifact',repeat('3',64),
  'timescale.analysis_body','timescale_history');
CREATE TABLE evidence_copy_receipts (
  receipt_id text PRIMARY KEY, artifact_id text NOT NULL, copy_id text NOT NULL,
  owner_id text NOT NULL, revision integer NOT NULL, predecessor_hash text,
  receipt_hash text NOT NULL UNIQUE, status text NOT NULL, observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id,copy_id,revision)
);
INSERT INTO evidence_copy_receipts VALUES ('ecd_'||repeat('6',48),'legacy-artifact',
  'timescale.analysis_body','timescale_history',1,NULL,repeat('7',64),'partial',now(),
  jsonb_build_object('artifact_id','legacy-artifact','copy_id','timescale.analysis_body'),now());
CREATE TABLE evidence_lifecycle_operation_receipts (
  receipt_id text PRIMARY KEY, artifact_id text NOT NULL, scope_key text NOT NULL,
  operation text NOT NULL, receipt_hash text NOT NULL UNIQUE, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO evidence_lifecycle_operation_receipts VALUES ('ear_'||repeat('8',48),
  'legacy-artifact','account:fixture','access',repeat('9',64),
  jsonb_build_object('idempotency_key','legacy-access','request_hash',repeat('a',64),
    'output',jsonb_build_object('confidence',0.75),'content','legacy-body'),now());

INSERT INTO evidence VALUES ('legacy_fixture','gdelt','urn:fixture',now(),NULL,1,
  repeat('a',64),'legacy body','{}');

\ir ../../migrations/010_evidence_lifecycle_boundary.sql
\ir ../../migrations/011_evidence_lifecycle_scope_identity.sql
\ir ../../migrations/012_physical_lifecycle_scope_identity.sql
\ir ../../migrations/013_trace_stream_body_integrity.sql

DO $$ BEGIN
  IF (SELECT lifecycle_state FROM evidence WHERE evidence_id='legacy_fixture')
      <> 'legacy_unclassified' THEN RAISE EXCEPTION 'legacy lifecycle backfill mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='migration_010_fixture'
      AND indexname='evidence_lifecycle_scope_time') THEN
    RAISE EXCEPTION 'lifecycle scope index missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid='evidence_lifecycle_decisions'::regclass
      AND tgname='evidence_lifecycle_decisions_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'lifecycle decision trigger missing'; END IF;
  IF to_regclass('migration_010_fixture.evidence_lifecycle_hold_outbox') IS NULL THEN
    RAISE EXCEPTION 'hold expiry outbox missing'; END IF;
  IF to_regclass('migration_010_fixture.evidence_lifecycle_command_outbox') IS NULL THEN
    RAISE EXCEPTION 'copy command outbox missing'; END IF;
  IF to_regclass('migration_010_fixture.evaluation_case_idempotency') IS NULL THEN
    RAISE EXCEPTION 'evaluation case idempotency missing'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='migration_010_fixture' AND table_name='evidence_copy_receipts'
        AND column_name='schedule_hash' AND is_nullable<>'NO') THEN
    RAISE EXCEPTION 'copy receipt schedule binding is nullable'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='migration_010_fixture'
        AND table_name='evidence_lifecycle_operation_receipts'
        AND column_name IN ('idempotency_key','request_hash') AND is_nullable<>'NO') THEN
    RAISE EXCEPTION 'operation idempotency binding is nullable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
      conname='evidence_lifecycle_command_outbox_schedule_scope_fk'
      AND conrelid='evidence_lifecycle_command_outbox'::regclass) THEN
    RAISE EXCEPTION 'command outbox schedule FK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
      conname='evidence_copy_receipts_schedule_scope_fk'
      AND conrelid='evidence_copy_receipts'::regclass) THEN
    RAISE EXCEPTION 'copy receipt schedule FK missing'; END IF;
  IF (SELECT count(*) FROM evidence_legacy_copy_receipts
      WHERE quarantine_reason='legacy_unbound_schedule') <> 1
      OR EXISTS (SELECT 1 FROM evidence_copy_receipts WHERE artifact_id='legacy-artifact') THEN
    RAISE EXCEPTION 'legacy receipt was guessed into an active schedule'; END IF;
  IF EXISTS (SELECT 1 FROM evidence_lifecycle_operation_receipts
      WHERE operation IN ('access','export') AND
        (payload ?| array['output','content'] OR payload->'receipt' ?| array['output','content'])) THEN
    RAISE EXCEPTION 'legacy disclosure body survived migration'; END IF;
END $$;

DO $$ DECLARE command_fk boolean := false; receipt_fk boolean := false; BEGIN
  INSERT INTO evidence_lifecycle_commands
    (command_id,artifact_id,scope_key,schedule_hash,owner_id,copy_id,revision,command_hash,idempotency_key,payload)
  VALUES ('elc_'||repeat('b',48),'fk-artifact','legacy_unbound',repeat('3',64),'timescale_history',
    'timescale.agent_trace',1,repeat('c',64),'fk-command','{}');
  BEGIN INSERT INTO evidence_lifecycle_command_outbox
    (command_hash,command_id,artifact_id,scope_key,schedule_hash,copy_id,owner_id)
    VALUES (repeat('c',64),'elc_'||repeat('b',48),'fk-artifact','legacy_unbound',repeat('d',64),
      'timescale.agent_trace','timescale_history');
  EXCEPTION WHEN foreign_key_violation THEN command_fk := true; END;
  BEGIN INSERT INTO evidence_copy_receipts
    (receipt_id,artifact_id,scope_key,schedule_hash,copy_id,owner_id,revision,receipt_hash,status,observed_at,payload)
    VALUES ('ecd_'||repeat('e',48),'fk-artifact','legacy_unbound',repeat('f',64),'timescale.agent_trace',
      'timescale_history',1,repeat('0',64),'partial',now(),'{}');
  EXCEPTION WHEN foreign_key_violation THEN receipt_fk := true; END;
  IF NOT command_fk OR NOT receipt_fk THEN RAISE EXCEPTION 'schedule FK did not enforce'; END IF;
END $$;

INSERT INTO evidence_lifecycle_decisions
  (decision_id,idempotency_key,input_digest,decision_hash,producer,purpose,sink,
   scope_kind,scope_key,policy_hash,inventory_hash,outcome,reasons,evaluated_at,expires_at,payload)
VALUES ('eld_'||repeat('a',48),'fixture:key',repeat('b',64),repeat('c',64),
  'push_evidence','evidence_ingest','timescale.evidence_body','public','public',
  repeat('d',64),repeat('e',64),'block','["prohibited_content"]',now(),
  now()+interval '5 minutes','{}');

-- Same physical identifiers and timestamps remain isolated by canonical scope.
INSERT INTO evidence_lifecycle_decisions
  (decision_id,idempotency_key,input_digest,decision_hash,producer,purpose,sink,
   scope_kind,scope_key,policy_hash,inventory_hash,outcome,reasons,evaluated_at,expires_at,payload)
VALUES
  ('eld_'||repeat('1',48),'case:a:key',repeat('1',64),repeat('1',64),
   'evaluation_case','evaluation','timescale.evaluation_case','tenant','tenant:fixture-a',
   repeat('2',64),repeat('3',64),'allow','[]',now(),now()+interval '5 minutes','{}'),
  ('eld_'||repeat('2',48),'case:b:key',repeat('2',64),repeat('2',64),
   'evaluation_case','evaluation','timescale.evaluation_case','tenant','tenant:fixture-b',
   repeat('3',64),repeat('4',64),'allow','[]',now(),now()+interval '5 minutes','{}');

INSERT INTO analysis_runs
  (scope_key,analysis_id,scope,account_id,synthesis,created_at)
VALUES
  ('account:fixture-a','shared-analysis','private','fixture-a','{"owner":"a"}',
   '2026-08-06T10:00:00Z'),
  ('account:fixture-b','shared-analysis','private','fixture-b','{"owner":"b"}',
   '2026-08-06T10:00:00Z');
INSERT INTO agent_trace_events
  (scope_key,event_id,analysis_id,account_id,input_summary,output_summary,created_at)
VALUES
  ('account:fixture-a','shared-event','shared-analysis','fixture-a','{}','{"owner":"a"}',
   '2026-08-06T10:00:00Z'),
  ('account:fixture-b','shared-event','shared-analysis','fixture-b','{}','{"owner":"b"}',
   '2026-08-06T10:00:00Z');
INSERT INTO evaluation_cases
  (scope_key,case_id,experiment_id,market,case_kind,repetition,market_snapshot,
   evidence_snapshot,snapshot_hash,observed_at,status,created_at,lifecycle_decision_hash)
VALUES
  ('tenant:fixture-a','shared-case','experiment-a','ETH','replay',1,'{"owner":"a"}',
   '[]',repeat('a',64),'2026-08-06T09:00:00Z','pending','2026-08-06T10:00:00Z',repeat('1',64)),
  ('tenant:fixture-b','shared-case','experiment-b','ETH','replay',1,'{"owner":"b"}',
   '[]',repeat('b',64),'2026-08-06T09:00:00Z','pending','2026-08-06T10:00:00Z',repeat('2',64));

UPDATE analysis_runs SET synthesis='{"cleared":true}'
 WHERE scope_key='account:fixture-a' AND analysis_id='shared-analysis';
UPDATE agent_trace_events SET output_summary='{}'
 WHERE scope_key='account:fixture-a' AND event_id='shared-event';
UPDATE evaluation_cases SET market_snapshot='{}',evidence_snapshot='[]',
  lifecycle_deleted_at='2026-08-06T11:00:00Z'
WHERE scope_key='tenant:fixture-a' AND case_id='shared-case' AND EXISTS (
  SELECT 1 FROM evidence_lifecycle_decisions d
  WHERE d.decision_hash=evaluation_cases.lifecycle_decision_hash
    AND d.scope_key='tenant:fixture-a');

DO $$ BEGIN
  IF (SELECT count(*) FROM analysis_runs WHERE analysis_id='shared-analysis')<>2
      OR (SELECT synthesis->>'owner' FROM analysis_runs
          WHERE scope_key='account:fixture-b' AND analysis_id='shared-analysis')<>'b' THEN
    RAISE EXCEPTION 'analysis physical scope collision or mutation leak'; END IF;
  IF (SELECT count(*) FROM agent_trace_events WHERE event_id='shared-event')<>2
      OR (SELECT output_summary->>'owner' FROM agent_trace_events
          WHERE scope_key='account:fixture-b' AND event_id='shared-event')<>'b' THEN
    RAISE EXCEPTION 'trace physical scope collision or mutation leak'; END IF;
  IF (SELECT count(*) FROM evaluation_cases WHERE case_id='shared-case')<>2
      OR (SELECT lifecycle_deleted_at FROM evaluation_cases
          WHERE scope_key='tenant:fixture-b' AND case_id='shared-case') IS NOT NULL
      OR (SELECT market_snapshot->>'owner' FROM evaluation_cases
          WHERE scope_key='tenant:fixture-b' AND case_id='shared-case')<>'b' THEN
    RAISE EXCEPTION 'evaluation physical scope collision or deletion leak'; END IF;
END $$;

\ir ../../migrations/010_evidence_lifecycle_boundary.sql
\ir ../../migrations/011_evidence_lifecycle_scope_identity.sql
\ir ../../migrations/012_physical_lifecycle_scope_identity.sql
\ir ../../migrations/013_trace_stream_body_integrity.sql

DO $$ DECLARE mutation_blocked boolean := false; BEGIN
  IF (SELECT count(*) FROM evidence_lifecycle_decisions) <> 3 THEN
    RAISE EXCEPTION 'rerun changed lifecycle rows'; END IF;
  BEGIN UPDATE evidence_lifecycle_decisions SET outcome='allow';
  EXCEPTION WHEN raise_exception THEN mutation_blocked := true; END;
  IF NOT mutation_blocked THEN RAISE EXCEPTION 'lifecycle mutation unexpectedly succeeded'; END IF;
END $$;

SET search_path TO public;
DROP SCHEMA migration_010_fixture CASCADE;
