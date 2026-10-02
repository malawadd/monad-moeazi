BEGIN;
CREATE SCHEMA migration_015_fixture;
SET search_path TO migration_015_fixture, public;
\ir ../../migrations/015_execution_artifact_certification.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='migration_015_fixture' AND table_name LIKE 'execution_artifact_%') <> 7 THEN RAISE EXCEPTION 'artifact certification schema closure mismatch'; END IF;
  BEGIN UPDATE execution_artifact_specs SET artifact_id='mutated'; RAISE EXCEPTION 'immutable trigger absent'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
ROLLBACK;
