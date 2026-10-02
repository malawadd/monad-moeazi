-- Run after migrations 001–026 in a disposable schema/database.
BEGIN;
DO $$ BEGIN
  IF to_regclass('termination_scopes') IS NULL OR to_regclass('termination_workflow_events') IS NULL THEN
    RAISE EXCEPTION 'migration 026 tables are absent';
  END IF;
END $$;
INSERT INTO termination_scopes(scope_hash,operator_test_id,payload)
VALUES (repeat('a',64),'operator:upgrade','{"fixture":"upgrade"}'::jsonb);
INSERT INTO termination_requests(scope_hash,request_hash,payload)
VALUES (repeat('a',64),repeat('b',64),'{"fixture":"request"}'::jsonb);
INSERT INTO termination_latches(scope_hash,latch_hash,payload)
VALUES (repeat('a',64),repeat('c',64),'{"fixture":"latch"}'::jsonb);
INSERT INTO termination_workflow_events(scope_hash,event_hash,payload)
VALUES (repeat('a',64),repeat('d',64),'{"fixture":"latched"}'::jsonb);
DO $$ BEGIN
  BEGIN UPDATE termination_latches SET payload='{}'::jsonb WHERE latch_hash=repeat('c',64); RAISE EXCEPTION 'UPDATE unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM termination_workflow_events WHERE event_hash=repeat('d',64); RAISE EXCEPTION 'DELETE unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
