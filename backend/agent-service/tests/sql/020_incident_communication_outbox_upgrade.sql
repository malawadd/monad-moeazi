BEGIN;
DO $$ BEGIN IF to_regclass('incident_communication_outbox') IS NULL THEN RAISE EXCEPTION 'migration 027 tables are absent'; END IF; END $$;
INSERT INTO incident_communication_scopes(scope_hash,operator_test_id,tenant_fingerprint,incident_id,payload) VALUES(repeat('a',64),'operator:upgrade','tenant:upgrade','incident:upgrade','{}');
INSERT INTO incident_communication_policies(scope_hash,policy_hash,payload) VALUES(repeat('a',64),repeat('b',64),'{}');
DO $$ BEGIN BEGIN UPDATE incident_communication_policies SET payload='{}' WHERE policy_hash=repeat('b',64); RAISE EXCEPTION 'UPDATE unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END; END $$;
ROLLBACK;
