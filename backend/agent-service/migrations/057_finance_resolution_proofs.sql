BEGIN;

CREATE TABLE IF NOT EXISTS finance_resolution_proofs (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL CHECK (scope_id <> 'live'),
  strategy_account_id text NOT NULL,
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  reservation_id text NOT NULL,
  attempt_id text NOT NULL,
  client_id text NOT NULL,
  normalized_payload_hash text NOT NULL CHECK (normalized_payload_hash ~ '^[0-9a-f]{64}$'),
  native_id text,
  source_owner text NOT NULL,
  source_stream text NOT NULL,
  source_event_id text NOT NULL,
  source_revision text NOT NULL,
  source_event_hash text NOT NULL CHECK (source_event_hash ~ '^[0-9a-f]{64}$'),
  source_payload_hash text NOT NULL CHECK (source_payload_hash ~ '^[0-9a-f]{64}$'),
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  finality_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('rejected_no_fill', 'filled')),
  rights_ref text NOT NULL CHECK (rights_ref = 'internal_qualification_only'),
  origin text NOT NULL CHECK (origin = 'recorded_fixture'),
  account_snapshot_hash text NOT NULL CHECK (account_snapshot_hash ~ '^[0-9a-f]{64}$'),
  linked_transaction_id text,
  proof_json jsonb NOT NULL CHECK (jsonb_typeof(proof_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, proof_hash),
  UNIQUE (environment, scope_id, strategy_account_id, reservation_id, source_owner,
          source_stream, source_event_id, source_revision),
  FOREIGN KEY (environment, scope_id, strategy_account_id, reservation_id)
    REFERENCES finance_reservations(environment, scope_id, strategy_account_id, reservation_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id, attempt_id)
    REFERENCES finance_submission_attempts(environment, scope_id, strategy_account_id, attempt_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id, linked_transaction_id)
    REFERENCES finance_journal_transactions(environment, scope_id, strategy_account_id, transaction_id),
  FOREIGN KEY (account_snapshot_hash) REFERENCES observation_account_snapshots(snapshot_hash),
  CHECK (event_at <= finality_at AND finality_at <= received_at),
  CHECK ((outcome = 'filled' AND linked_transaction_id IS NOT NULL)
      OR (outcome = 'rejected_no_fill' AND linked_transaction_id IS NULL))
);

CREATE OR REPLACE FUNCTION reject_finance_resolution_proof_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finance resolution proofs are immutable';
END;
$$;

DROP TRIGGER IF EXISTS finance_resolution_proofs_immutable ON finance_resolution_proofs;
CREATE TRIGGER finance_resolution_proofs_immutable BEFORE UPDATE OR DELETE
  ON finance_resolution_proofs FOR EACH ROW EXECUTE FUNCTION reject_finance_resolution_proof_change();

COMMIT;
