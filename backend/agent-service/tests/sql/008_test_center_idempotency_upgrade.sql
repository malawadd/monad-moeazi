\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS migration_008_fixture CASCADE;
CREATE SCHEMA migration_008_fixture;
SET search_path TO migration_008_fixture, public;

CREATE FUNCTION reject_dependency_safety_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;

CREATE TABLE agent_test_center_runs (
  run_id text PRIMARY KEY,
  operator_test_id text NOT NULL,
  payload jsonb NOT NULL
);

INSERT INTO agent_test_center_runs(run_id, operator_test_id, payload)
VALUES ('run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'operator_fixture', '{"legacy":true}');

CREATE TRIGGER agent_test_center_runs_immutable
  BEFORE UPDATE OR DELETE ON agent_test_center_runs
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

\ir ../../migrations/008_dependency_safety_v2_test_center_idempotency.sql

DO $$
DECLARE fixture agent_test_center_runs%ROWTYPE;
BEGIN
  SELECT * INTO fixture FROM agent_test_center_runs;
  IF fixture.idempotency_key <> fixture.run_id THEN
    RAISE EXCEPTION 'legacy idempotency backfill mismatch';
  END IF;
  IF fixture.request_hash <> repeat('0', 64) THEN
    RAISE EXCEPTION 'legacy request hash backfill mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'migration_008_fixture'
    AND indexname = 'agent_test_center_run_idempotency') THEN
    RAISE EXCEPTION 'idempotency index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'agent_test_center_runs'::regclass
    AND tgname = 'agent_test_center_runs_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'immutable trigger missing';
  END IF;
END $$;

\ir ../../migrations/008_dependency_safety_v2_test_center_idempotency.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM agent_test_center_runs) <> 1 THEN
    RAISE EXCEPTION 'rerun changed fixture rows';
  END IF;
END $$;

SET search_path TO public;
DROP SCHEMA migration_008_fixture CASCADE;
