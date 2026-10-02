BEGIN;

-- One owner-approved, reduce-only WETH exit after managed admission is stopped.
-- The writer keeps the immutable grant/owner/subject identity alongside possible
-- submission; later reconciliation never asks Convex to authorize a new entry.
CREATE TABLE IF NOT EXISTS finance_live_uniswap_exit_bindings (
  environment text NOT NULL DEFAULT 'live' CHECK (environment='live'),
  scope_id text NOT NULL DEFAULT 'live' CHECK (scope_id='live'),
  strategy_account_id text NOT NULL,
  attempt_id text NOT NULL,
  reservation_id text NOT NULL,
  assignment_id text NOT NULL,
  program_version_id text NOT NULL,
  customer_subject text NOT NULL,
  command_id text NOT NULL,
  intent_id text NOT NULL,
  grant_id text NOT NULL,
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  frozen_program_policy_hash text NOT NULL
    CHECK (frozen_program_policy_hash ~ '^0x[0-9a-f]{64}$'),
  controller_ref jsonb NOT NULL CHECK (jsonb_typeof(controller_ref)='object'),
  quote_hash text NOT NULL CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  amount_in finance_native_units NOT NULL CHECK (amount_in>0),
  amount_out_minimum finance_native_units NOT NULL CHECK (amount_out_minimum>0),
  deadline numeric NOT NULL CHECK (deadline>0 AND deadline=trunc(deadline)),
  normalized_payload_hash text NOT NULL CHECK (normalized_payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,attempt_id),
  UNIQUE (environment,scope_id,strategy_account_id,reservation_id),
  UNIQUE (environment,scope_id,strategy_account_id,assignment_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,attempt_id)
    REFERENCES finance_submission_attempts(environment,scope_id,strategy_account_id,attempt_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,reservation_id)
    REFERENCES finance_reservations(environment,scope_id,strategy_account_id,reservation_id),
  FOREIGN KEY (quote_hash) REFERENCES observation_uniswap_v3_quotes(quote_hash)
);

CREATE OR REPLACE FUNCTION reject_live_uniswap_exit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'native Uniswap exit evidence is immutable';
END;
$$;
DROP TRIGGER IF EXISTS finance_live_uniswap_exit_bindings_immutable
  ON finance_live_uniswap_exit_bindings;
CREATE TRIGGER finance_live_uniswap_exit_bindings_immutable BEFORE UPDATE OR DELETE
  ON finance_live_uniswap_exit_bindings FOR EACH ROW
  EXECUTE FUNCTION reject_live_uniswap_exit_change();

CREATE TABLE IF NOT EXISTS finance_live_uniswap_exit_fills (
  environment text NOT NULL DEFAULT 'live' CHECK (environment='live'),
  scope_id text NOT NULL DEFAULT 'live' CHECK (scope_id='live'),
  strategy_account_id text NOT NULL,
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  reservation_id text NOT NULL,
  attempt_id text NOT NULL,
  grant_id text NOT NULL,
  user_operation_hash text NOT NULL CHECK (user_operation_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  confirmed_block_number numeric NOT NULL
    CHECK (confirmed_block_number>0 AND confirmed_block_number=trunc(confirmed_block_number)),
  confirmed_block_hash text NOT NULL CHECK (confirmed_block_hash ~ '^0x[0-9a-f]{64}$'),
  actual_input_units finance_native_units NOT NULL CHECK (actual_input_units>0),
  actual_output_units finance_native_units NOT NULL CHECK (actual_output_units>0),
  before_snapshot_hash text NOT NULL CHECK (before_snapshot_hash ~ '^[0-9a-f]{64}$'),
  after_snapshot_hash text NOT NULL CHECK (after_snapshot_hash ~ '^[0-9a-f]{64}$'),
  journal_transaction_id text NOT NULL,
  proof_json jsonb NOT NULL CHECK (jsonb_typeof(proof_json)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,proof_hash),
  UNIQUE (environment,scope_id,strategy_account_id,reservation_id),
  UNIQUE (environment,scope_id,strategy_account_id,attempt_id),
  UNIQUE (environment,scope_id,strategy_account_id,transaction_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,attempt_id)
    REFERENCES finance_live_uniswap_exit_bindings(environment,scope_id,strategy_account_id,attempt_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,reservation_id)
    REFERENCES finance_reservations(environment,scope_id,strategy_account_id,reservation_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,journal_transaction_id)
    REFERENCES finance_journal_transactions(environment,scope_id,strategy_account_id,transaction_id),
  FOREIGN KEY (before_snapshot_hash) REFERENCES observation_account_snapshots(snapshot_hash),
  FOREIGN KEY (after_snapshot_hash) REFERENCES observation_account_snapshots(snapshot_hash)
);
DROP TRIGGER IF EXISTS finance_live_uniswap_exit_fills_immutable
  ON finance_live_uniswap_exit_fills;
CREATE TRIGGER finance_live_uniswap_exit_fills_immutable BEFORE UPDATE OR DELETE
  ON finance_live_uniswap_exit_fills FOR EACH ROW
  EXECUTE FUNCTION reject_live_uniswap_exit_change();

COMMIT;
