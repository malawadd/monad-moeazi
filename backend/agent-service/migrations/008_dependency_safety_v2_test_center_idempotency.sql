BEGIN;

DROP TRIGGER IF EXISTS agent_test_center_runs_immutable ON agent_test_center_runs;

ALTER TABLE agent_test_center_runs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE agent_test_center_runs ADD COLUMN IF NOT EXISTS request_hash text;

UPDATE agent_test_center_runs
SET idempotency_key = CASE
  WHEN length(run_id) BETWEEN 8 AND 80 AND run_id ~ '^[A-Za-z0-9._:-]+$' THEN run_id
  ELSE 'legacy:' || md5(run_id)
END
WHERE idempotency_key IS NULL;

UPDATE agent_test_center_runs
SET request_hash = repeat('0', 64)
WHERE request_hash IS NULL;

ALTER TABLE agent_test_center_runs ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE agent_test_center_runs ALTER COLUMN request_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
    conname = 'agent_test_center_runs_idempotency_key_check'
    AND conrelid = 'agent_test_center_runs'::regclass) THEN
    ALTER TABLE agent_test_center_runs ADD CONSTRAINT agent_test_center_runs_idempotency_key_check
      CHECK (length(idempotency_key) BETWEEN 8 AND 80
        AND idempotency_key ~ '^[A-Za-z0-9._:-]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
    conname = 'agent_test_center_runs_request_hash_check'
    AND conrelid = 'agent_test_center_runs'::regclass) THEN
    ALTER TABLE agent_test_center_runs ADD CONSTRAINT agent_test_center_runs_request_hash_check
      CHECK (request_hash ~ '^[a-f0-9]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agent_test_center_run_idempotency
  ON agent_test_center_runs (operator_test_id, idempotency_key);

DROP TRIGGER IF EXISTS agent_test_center_runs_immutable ON agent_test_center_runs;
CREATE TRIGGER agent_test_center_runs_immutable
  BEFORE UPDATE OR DELETE ON agent_test_center_runs
  FOR EACH ROW EXECUTE FUNCTION reject_dependency_safety_mutation();

COMMIT;
