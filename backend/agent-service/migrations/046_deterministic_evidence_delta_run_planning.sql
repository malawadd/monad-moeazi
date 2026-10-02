-- Feature 34 local fixture history only. No product scheduler or credit state is touched.
CREATE TABLE IF NOT EXISTS run_planning_requests (
 operator_test_id text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
 root_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (operator_test_id,idempotency_key), CHECK (request_hash ~ '^[a-f0-9]{64}$'), CHECK (root_hash ~ '^[a-f0-9]{64}$'));
CREATE TABLE IF NOT EXISTS run_planning_receipts (
 operator_test_id text NOT NULL, root_hash text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(operator_test_id,root_hash));
CREATE OR REPLACE FUNCTION reject_run_planning_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'run planning fixture history is immutable'; END $$;
DROP TRIGGER IF EXISTS run_planning_requests_immutable ON run_planning_requests;
CREATE TRIGGER run_planning_requests_immutable BEFORE UPDATE OR DELETE ON run_planning_requests FOR EACH ROW EXECUTE FUNCTION reject_run_planning_mutation();
DROP TRIGGER IF EXISTS run_planning_receipts_immutable ON run_planning_receipts;
CREATE TRIGGER run_planning_receipts_immutable BEFORE UPDATE OR DELETE ON run_planning_receipts FOR EACH ROW EXECUTE FUNCTION reject_run_planning_mutation();
