-- Disposable local upgrade probe. Harness applies 029 twice in a validated schema.
BEGIN;
DO $$ BEGIN IF to_regclass('agent_test_center_runs') IS NULL OR to_regclass('safety_change_scopes') IS NULL THEN RAISE EXCEPTION 'pre-029 Test Center/Feature16 rows are absent'; END IF; END $$;
SELECT to_regclass('operator_qualification_scopes') IS NOT NULL AS scope_table_exists;
SELECT to_regclass('operator_qualification_grants') IS NOT NULL AS grant_table_exists;
SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'operator_qualification_grants'::regclass
  AND tgname = 'operator_qualification_grants_immutable') AS immutable_trigger_exists;
INSERT INTO operator_qualification_scopes VALUES(repeat('1',64),'operator:one','tenant:one','scope:one','local','{}');
INSERT INTO operator_qualification_scopes VALUES(repeat('2',64),'operator:two','tenant:two','scope:two','local','{}');
INSERT INTO operator_qualification_decisions VALUES(repeat('1',64),repeat('3',64),'{}');
DO $$ BEGIN BEGIN INSERT INTO operator_qualification_test_center_bundles(run_id,scope_hash,decision_hash) VALUES('run-00000000000000000000000000000000',repeat('2',64),repeat('3',64)); RAISE EXCEPTION 'cross-scope bundle unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%cross-scope%' THEN RAISE; END IF; END; END $$;
DO $$ BEGIN BEGIN UPDATE operator_qualification_decisions SET payload='{}' WHERE decision_hash=repeat('3',64); RAISE EXCEPTION 'UPDATE unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END; BEGIN DELETE FROM operator_qualification_decisions WHERE decision_hash=repeat('3',64); RAISE EXCEPTION 'DELETE unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END; END $$;
ROLLBACK;
