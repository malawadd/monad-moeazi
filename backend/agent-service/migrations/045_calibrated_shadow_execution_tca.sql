-- Local-only append-only Feature 33 fixture research; never read by product execution.
CREATE TABLE IF NOT EXISTS shadow_tca_runs (
 operator_test_id text NOT NULL, run_hash text NOT NULL CHECK (run_hash ~ '^[a-f0-9]{64}$'),
 artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'), payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(operator_test_id,run_hash));
CREATE TABLE IF NOT EXISTS shadow_tca_receipts (
 operator_test_id text NOT NULL, run_hash text NOT NULL, artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
 payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(operator_test_id,run_hash), FOREIGN KEY(operator_test_id,run_hash) REFERENCES shadow_tca_runs(operator_test_id,run_hash));
CREATE TABLE IF NOT EXISTS shadow_tca_request_claims (
 operator_test_id text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 run_hash text NOT NULL CHECK (run_hash ~ '^[a-f0-9]{64}$'), payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(operator_test_id,idempotency_key), FOREIGN KEY(operator_test_id,run_hash) REFERENCES shadow_tca_runs(operator_test_id,run_hash));
