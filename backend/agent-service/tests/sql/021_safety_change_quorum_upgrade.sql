BEGIN;
DO $$ BEGIN IF to_regclass('safety_change_scopes') IS NULL THEN RAISE EXCEPTION 'migration 028 tables are absent'; END IF; END $$;
INSERT INTO safety_change_scopes(scope_hash,operator_test_id,tenant_fingerprint,scope_id,payload) VALUES(repeat('a',64),'operator:upgrade','tenant:upgrade','scope:upgrade','{}');
INSERT INTO safety_change_requests(scope_hash,request_hash,payload) VALUES(repeat('a',64),repeat('b',64),'{}');
DO $$ BEGIN BEGIN UPDATE safety_change_requests SET payload='{}' WHERE request_hash=repeat('b',64); RAISE EXCEPTION 'UPDATE unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END; END $$;
ROLLBACK;
