\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS migration_009_fixture CASCADE;
CREATE SCHEMA migration_009_fixture;
SET search_path TO migration_009_fixture, public;

CREATE FUNCTION reject_dependency_safety_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;

CREATE TABLE agent_test_center_runs (
  run_id text PRIMARY KEY, operator_test_id text NOT NULL, scenario_id text NOT NULL,
  mode text NOT NULL, repository_sha text NOT NULL, registry_version text NOT NULL,
  registry_hash text NOT NULL, control_hash text NOT NULL, fixture_hash text NOT NULL,
  safe_environment text NOT NULL, invariant_verdict text NOT NULL,
  idempotency_key text NOT NULL, request_hash text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_test_center_events (
  event_id text PRIMARY KEY, run_id text NOT NULL REFERENCES agent_test_center_runs(run_id),
  sequence integer NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id, sequence)
);
CREATE TABLE agent_test_center_control_changes (
  change_id text PRIMARY KEY, operator_test_id text NOT NULL, previous_hash text NOT NULL,
  control_hash text NOT NULL, revision integer NOT NULL, expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO agent_test_center_runs VALUES
  ('run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','operator_fixture','healthy-render','observe',
   repeat('a',40),'v2',repeat('b',64),repeat('c',64),repeat('d',64),'test','pass',
   'legacy:key',repeat('e',64),'{}',now());
INSERT INTO agent_test_center_events(event_id,run_id,sequence,event_type,payload)
  VALUES ('event_fixture','run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'run_frozen','{}');
INSERT INTO agent_test_center_control_changes
  (change_id,operator_test_id,previous_hash,control_hash,revision,expires_at,payload)
  VALUES ('change_fixture','operator_fixture',repeat('0',64),repeat('1',64),1,now() + interval '1 hour','{}');

CREATE TRIGGER agent_test_center_runs_immutable BEFORE UPDATE OR DELETE ON agent_test_center_runs
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();
CREATE TRIGGER agent_test_center_events_immutable BEFORE UPDATE OR DELETE ON agent_test_center_events
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();
CREATE TRIGGER agent_test_center_controls_immutable BEFORE UPDATE OR DELETE ON agent_test_center_control_changes
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

\ir ../../migrations/009_cross_state_recovery_continuity.sql

DO $$
BEGIN
  IF (SELECT feature_id FROM agent_test_center_runs LIMIT 1) <> 'dependency-safety-envelope'
    OR (SELECT feature_id FROM agent_test_center_events LIMIT 1) <> 'dependency-safety-envelope'
    OR (SELECT feature_id FROM agent_test_center_control_changes LIMIT 1) <> 'dependency-safety-envelope' THEN
    RAISE EXCEPTION 'Feature 01 backfill mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='migration_009_fixture'
    AND indexname='agent_test_center_runs_feature_created') THEN RAISE EXCEPTION 'feature index missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='recovery_artifacts'::regclass
    AND tgname='recovery_artifacts_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'artifact trigger missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='recovery_run_events'::regclass
    AND tgname='recovery_run_events_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'event trigger missing'; END IF;
END $$;

INSERT INTO recovery_artifacts
  (artifact_id,artifact_kind,run_id,scope_key,produced_at,idempotency_key,canonical_hash,payload)
VALUES ('artifact_fixture','point_set','run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'tenant_aaaaaaaaaaaaaaaa',now(),'fixture:key',repeat('f',64),'{}');
INSERT INTO recovery_run_events
  (event_id,run_id,sequence,state,artifact_hash,occurred_at,payload)
VALUES ('recovery_event_fixture','run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'planned',repeat('f',64),now(),'{}');

\ir ../../migrations/009_cross_state_recovery_continuity.sql

DO $$ DECLARE mutation_blocked boolean := false; BEGIN
  IF (SELECT count(*) FROM recovery_artifacts) <> 1 OR (SELECT count(*) FROM recovery_run_events) <> 1
  THEN RAISE EXCEPTION 'rerun changed recovery rows'; END IF;
  BEGIN UPDATE recovery_artifacts SET payload='{"changed":true}';
  EXCEPTION WHEN raise_exception THEN mutation_blocked := true; END;
  IF NOT mutation_blocked THEN RAISE EXCEPTION 'artifact mutation unexpectedly succeeded'; END IF;
END $$;

SET search_path TO public;
DROP SCHEMA migration_009_fixture CASCADE;
