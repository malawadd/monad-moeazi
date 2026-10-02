-- Disposable, local-only migration proof. It leaves no schema behind.
BEGIN;
CREATE SCHEMA effective_authority_proof;
SET search_path TO effective_authority_proof,public;
CREATE TABLE agent_test_center_runs(run_id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE agent_test_center_events(event_id text PRIMARY KEY, run_id text NOT NULL REFERENCES agent_test_center_runs(run_id), payload jsonb NOT NULL);
INSERT INTO agent_test_center_runs VALUES ('run-pre-031','{}');
INSERT INTO agent_test_center_events VALUES ('event-pre-031','run-pre-031','{}');
\i ../../migrations/031_effective_authority_decision.sql
\i ../../migrations/031_effective_authority_decision.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM agent_test_center_runs) <> 1 OR (SELECT count(*) FROM agent_test_center_events) <> 1 THEN
    RAISE EXCEPTION 'preexisting generic Test Center rows changed';
  END IF;
END $$;
INSERT INTO effective_authority_scopes(scope_hash,operator_test_id,tenant_fingerprint,payload)
VALUES(repeat('a',64),'operator:test','tenant:fixture','{}');
INSERT INTO effective_authority_decisions(artifact_hash,scope_hash,operator_test_id,sequence,payload)
VALUES(repeat('b',64),repeat('a',64),'operator:test',1,'{"capability":"PREFLIGHT_ONLY","phase":"PREFLIGHT_ONLY","reasons":[]}');
DO $$ BEGIN
  BEGIN
    INSERT INTO effective_authority_decisions(artifact_hash,scope_hash,operator_test_id,payload)
    VALUES(repeat('c',64),repeat('d',64),'operator:test','{}');
    RAISE EXCEPTION 'cross-scope foreign key accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE effective_authority_decisions SET payload='{}';
    RAISE EXCEPTION 'mutation accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM!='effective_authority_append_only' THEN RAISE; END IF;
  END;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM effective_authority_current_fixture_projection WHERE scope_hash=repeat('a',64) AND capability='PREFLIGHT_ONLY') THEN
    RAISE EXCEPTION 'sanitized current view missing';
  END IF;
END $$;
ROLLBACK;
