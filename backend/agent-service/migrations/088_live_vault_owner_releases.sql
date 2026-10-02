BEGIN;

CREATE TABLE IF NOT EXISTS finance_live_vault_owner_releases (
  environment text NOT NULL DEFAULT 'live' CHECK (environment='live'),
  scope_id text NOT NULL DEFAULT 'live' CHECK (scope_id='live'),
  strategy_account_id text NOT NULL,
  mandate_id text NOT NULL,
  vault_address text NOT NULL CHECK (vault_address ~ '^0x[0-9a-f]{40}$'),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  confirmed_block_number numeric NOT NULL CHECK (confirmed_block_number>0 AND confirmed_block_number=trunc(confirmed_block_number)),
  confirmed_block_hash text NOT NULL CHECK (confirmed_block_hash ~ '^0x[0-9a-f]{64}$'),
  amount_units finance_native_units NOT NULL CHECK (amount_units>0),
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  before_snapshot_hash text NOT NULL CHECK (before_snapshot_hash ~ '^[0-9a-f]{64}$'),
  after_snapshot_hash text NOT NULL CHECK (after_snapshot_hash ~ '^[0-9a-f]{64}$'),
  journal_transaction_id text NOT NULL,
  proof_json jsonb NOT NULL CHECK (jsonb_typeof(proof_json)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,mandate_id),
  UNIQUE (environment,scope_id,strategy_account_id,transaction_hash),
  UNIQUE (environment,scope_id,strategy_account_id,proof_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,journal_transaction_id)
    REFERENCES finance_journal_transactions(environment,scope_id,strategy_account_id,transaction_id),
  FOREIGN KEY (before_snapshot_hash) REFERENCES observation_account_snapshots(snapshot_hash),
  FOREIGN KEY (after_snapshot_hash) REFERENCES observation_account_snapshots(snapshot_hash)
);

CREATE OR REPLACE FUNCTION reject_live_vault_owner_release_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'native vault owner release proofs are immutable';
END;
$$;
DROP TRIGGER IF EXISTS finance_live_vault_owner_releases_immutable ON finance_live_vault_owner_releases;
CREATE TRIGGER finance_live_vault_owner_releases_immutable BEFORE UPDATE OR DELETE
  ON finance_live_vault_owner_releases FOR EACH ROW EXECUTE FUNCTION reject_live_vault_owner_release_change();

COMMIT;
