-- Run with psql only in a disposable local schema; it preserves pre-030 generic rows.
CREATE SCHEMA IF NOT EXISTS mandate_policy_proof;
SET search_path TO mandate_policy_proof, public;
CREATE TABLE agent_test_center_runs (run_id text PRIMARY KEY, operator_test_id text NOT NULL, feature_id text NOT NULL, scenario_id text NOT NULL, mode text NOT NULL, repository_sha text NOT NULL, registry_version text NOT NULL, registry_hash char(64) NOT NULL, control_hash char(64) NOT NULL, fixture_hash char(64) NOT NULL, safe_environment text NOT NULL, invariant_verdict text NOT NULL, idempotency_key text NOT NULL, request_hash char(64) NOT NULL, payload jsonb NOT NULL, UNIQUE(operator_test_id,idempotency_key));
CREATE TABLE agent_test_center_events (event_id text PRIMARY KEY, run_id text REFERENCES agent_test_center_runs(run_id), feature_id text NOT NULL, sequence integer NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL);
INSERT INTO agent_test_center_runs VALUES ('legacy16','legacy','execution-artifact-certification','fixture','observe',repeat('a',40),'v1',repeat('a',64),repeat('a',64),repeat('a',64),'local','pass','legacy16',repeat('a',64),'{}'),('legacy17','legacy','operator-qualification','fixture','observe',repeat('a',40),'v1',repeat('a',64),repeat('a',64),repeat('a',64),'local','pass','legacy17',repeat('b',64),'{}');
\i ../../migrations/030_mandate_policy_semantic_fidelity.sql
\i ../../migrations/030_mandate_policy_semantic_fidelity.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM agent_test_center_runs) <> 2 THEN RAISE EXCEPTION 'seed rows changed'; END IF;
  IF to_regclass('mandate_policy_proof.mandate_policy_test_center_bundles') IS NULL OR to_regclass('mandate_policy_proof.mandate_policy_artifact_links') IS NULL THEN RAISE EXCEPTION 'migration tables missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='mandate_policy_activation_receipts'::regclass AND NOT tgisinternal) THEN RAISE EXCEPTION 'immutability trigger missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='mandate_policy_request_claims' AND indexname='mandate_policy_request_claim_unique') THEN RAISE EXCEPTION 'claim index missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mandate_policy_bundle_generic_run') THEN RAISE EXCEPTION 'generic run FK missing'; END IF;
END $$;
INSERT INTO mandate_policy_scopes VALUES (repeat('1',64),'operator','tenant','user','account','local','{}',now());
INSERT INTO mandate_policy_request_claims(artifact_hash,scope_hash,operator_test_id,idempotency_key,request_hash,payload) VALUES (repeat('2',64),repeat('1',64),'operator','once',repeat('3',64),'{}');
DO $$ BEGIN
  BEGIN UPDATE mandate_policy_request_claims SET payload='{}'; RAISE EXCEPTION 'mutation accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'mandate_policy_append_only' THEN RAISE; END IF; END;
END $$;
DROP SCHEMA mandate_policy_proof CASCADE;
