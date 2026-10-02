BEGIN;

DO $$ BEGIN
  CREATE DOMAIN finance_native_units AS numeric
    CHECK (VALUE = trunc(VALUE) AND abs(VALUE) < 1e78);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ordinary PostgreSQL tables: these are operational financial state, not the
-- immutable Test Center risk_* and journal_* fixture tables.
CREATE TABLE IF NOT EXISTS finance_accounts (
  environment text NOT NULL CHECK (environment IN ('live', 'experiment')),
  scope_id text NOT NULL,
  strategy_account_id text NOT NULL,
  source_account_id text,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  writer_epoch bigint NOT NULL DEFAULT 0 CHECK (writer_epoch >= 0),
  writer_id text,
  writer_lease_until timestamptz,
  authority_epoch bigint NOT NULL DEFAULT 0 CHECK (authority_epoch >= 0),
  admission_state text NOT NULL DEFAULT 'stopped'
    CHECK (admission_state IN ('stopped', 'open')),
  reconciliation_state text NOT NULL DEFAULT 'unknown'
    CHECK (reconciliation_state IN ('unknown', 'clean', 'quarantined')),
  reconciliation_reason text NOT NULL DEFAULT 'not_bootstrapped',
  observation_snapshot_hash text,
  policy_version text,
  policy_hash text,
  observed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id),
  CHECK ((environment = 'live' AND scope_id = 'live') OR
         (environment = 'experiment' AND scope_id <> 'live')),
  CHECK (observation_snapshot_hash IS NULL OR
         observation_snapshot_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS finance_source_events (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  source_event_hash text NOT NULL CHECK (source_event_hash ~ '^[a-f0-9]{64}$'),
  source_owner text NOT NULL, source_stream text NOT NULL,
  source_event_id text NOT NULL, source_revision text NOT NULL,
  source_payload_hash text NOT NULL CHECK (source_payload_hash ~ '^[a-f0-9]{64}$'),
  event_kind text NOT NULL, observed_at timestamptz NOT NULL,
  reverses_event_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, source_event_hash),
  UNIQUE (environment, scope_id, strategy_account_id,
          source_owner, source_stream, source_event_id, source_revision),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_journal_transactions (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  transaction_id text NOT NULL,
  source_event_hash text NOT NULL,
  reverses_transaction_id text,
  posting_count integer NOT NULL CHECK (posting_count >= 2),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  account_revision bigint NOT NULL CHECK (account_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, transaction_id),
  UNIQUE (environment, scope_id, strategy_account_id, source_event_hash),
  FOREIGN KEY (environment, scope_id, strategy_account_id, reverses_transaction_id)
    REFERENCES finance_journal_transactions(environment, scope_id, strategy_account_id, transaction_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id, source_event_hash)
    REFERENCES finance_source_events(environment, scope_id, strategy_account_id, source_event_hash),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_one_full_reversal
  ON finance_journal_transactions(environment, scope_id, strategy_account_id, reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_journal_postings (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  transaction_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal > 0),
  asset_unit_id text NOT NULL, registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'),
  location_id text NOT NULL,
  book text NOT NULL CHECK (book IN ('wallet','collateral','transit','external',
    'liability','pnl','fees','funding','gas')),
  units finance_native_units NOT NULL CHECK (units <> 0),
  PRIMARY KEY (environment, scope_id, strategy_account_id, transaction_id, ordinal),
  FOREIGN KEY (environment, scope_id, strategy_account_id, transaction_id)
    REFERENCES finance_journal_transactions(environment, scope_id, strategy_account_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS finance_balances (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  asset_unit_id text NOT NULL, registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'),
  location_id text NOT NULL, book text NOT NULL,
  units finance_native_units NOT NULL DEFAULT 0,
  account_revision bigint NOT NULL CHECK (account_revision >= 0),
  PRIMARY KEY (environment, scope_id, strategy_account_id,
               asset_unit_id, location_id, book),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_positions (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  instrument_version_id text NOT NULL, location_id text NOT NULL,
  signed_contracts finance_native_units NOT NULL,
  instrument_registry_hash text NOT NULL CHECK (instrument_registry_hash ~ '^[a-f0-9]{64}$'),
  contract_size_unit_id text NOT NULL,
  collateral_asset_unit_id text NOT NULL, margin_units finance_native_units NOT NULL CHECK (margin_units >= 0),
  observation_snapshot_hash text NOT NULL CHECK (observation_snapshot_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (environment, scope_id, strategy_account_id, instrument_version_id, location_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_capacity (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  capacity_key text NOT NULL, asset_unit_id text NOT NULL,
  registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'), location_id text NOT NULL,
  limit_units finance_native_units NOT NULL CHECK (limit_units >= 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL, policy_hash text NOT NULL,
  account_revision bigint NOT NULL CHECK (account_revision > 0),
  PRIMARY KEY (environment, scope_id, strategy_account_id, capacity_key),
  UNIQUE (environment, scope_id, strategy_account_id,
          capacity_key, asset_unit_id, registry_hash, location_id),
  UNIQUE (environment, scope_id, strategy_account_id, asset_unit_id, location_id),
  CHECK (capacity_key = 'asset:' || asset_unit_id || ':' || location_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_policy_versions (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  policy_version text NOT NULL, policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  policy_json jsonb NOT NULL, approved_live boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, policy_version),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_calculation_receipts (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  account_revision bigint NOT NULL CHECK (account_revision >= 0),
  observation_snapshot_hash text NOT NULL CHECK (observation_snapshot_hash ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL, policy_hash text NOT NULL,
  receipt_json jsonb NOT NULL,
  authority_class text NOT NULL CHECK (authority_class IN ('experiment_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, receipt_hash),
  FOREIGN KEY (environment, scope_id, strategy_account_id, policy_version)
    REFERENCES finance_policy_versions(environment, scope_id, strategy_account_id, policy_version)
);

CREATE TABLE IF NOT EXISTS finance_reconciliation_checkpoints (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  account_revision bigint NOT NULL CHECK (account_revision > 0),
  observation_snapshot_hash text NOT NULL CHECK (observation_snapshot_hash ~ '^[a-f0-9]{64}$'),
  journal_root_hash text NOT NULL CHECK (journal_root_hash ~ '^[a-f0-9]{64}$'),
  result text NOT NULL CHECK (result IN ('clean','unknown','quarantined')),
  reason text NOT NULL, observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, account_revision),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_reservations (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  reservation_id text NOT NULL, idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  intent_id text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('trade','withdrawal')),
  controller_ref jsonb NOT NULL, controller_mode text NOT NULL,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL, policy_hash text NOT NULL,
  writer_epoch bigint NOT NULL, authority_epoch bigint NOT NULL,
  authority_fingerprint text NOT NULL CHECK (authority_fingerprint ~ '^[a-f0-9]{64}$'),
  calculation_receipt_hash text NOT NULL,
  admitted_revision bigint NOT NULL CHECK (admitted_revision > 0),
  status text NOT NULL CHECK (status IN ('reserved','submitted','uncertain','settled','released')),
  expires_at timestamptz NOT NULL, retention_reason text,
  resolution_proof_hash text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, reservation_id),
  UNIQUE (environment, scope_id, strategy_account_id, idempotency_key),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id, calculation_receipt_hash)
    REFERENCES finance_calculation_receipts(environment, scope_id, strategy_account_id, receipt_hash)
);

CREATE TABLE IF NOT EXISTS finance_reservation_components (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  reservation_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal > 0),
  capacity_key text NOT NULL, asset_unit_id text NOT NULL,
  registry_hash text NOT NULL CHECK (registry_hash ~ '^[a-f0-9]{64}$'), location_id text NOT NULL,
  units finance_native_units NOT NULL CHECK (units > 0),
  PRIMARY KEY (environment, scope_id, strategy_account_id, reservation_id, ordinal),
  FOREIGN KEY (environment, scope_id, strategy_account_id, reservation_id)
    REFERENCES finance_reservations(environment, scope_id, strategy_account_id, reservation_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id,
               capacity_key, asset_unit_id, registry_hash, location_id)
    REFERENCES finance_capacity(environment, scope_id, strategy_account_id,
      capacity_key, asset_unit_id, registry_hash, location_id)
);
CREATE INDEX IF NOT EXISTS finance_held_capacity ON finance_reservation_components
  (environment, scope_id, strategy_account_id, capacity_key);

CREATE TABLE IF NOT EXISTS finance_submission_attempts (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  attempt_id text NOT NULL, reservation_id text NOT NULL,
  client_id text NOT NULL, normalized_payload_hash text NOT NULL
    CHECK (normalized_payload_hash ~ '^[a-f0-9]{64}$'),
  native_id text, status text NOT NULL CHECK (status IN ('possible','confirmed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, attempt_id),
  UNIQUE (environment, scope_id, strategy_account_id, client_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id, reservation_id)
    REFERENCES finance_reservations(environment, scope_id, strategy_account_id, reservation_id)
);

CREATE TABLE IF NOT EXISTS finance_command_claims (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  operation text NOT NULL, idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_id text NOT NULL, account_revision bigint NOT NULL CHECK (account_revision > 0),
  PRIMARY KEY (environment, scope_id, strategy_account_id, operation, idempotency_key),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_pending_events (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  source_event_hash text NOT NULL CHECK (source_event_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  command_json jsonb NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, source_event_hash),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE TABLE IF NOT EXISTS finance_outbox (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  account_revision bigint NOT NULL CHECK (account_revision > 0),
  event_id text NOT NULL, payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL, published_at timestamptz,
  claim_id text, claimed_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, scope_id, strategy_account_id, account_revision),
  UNIQUE (event_id),
  FOREIGN KEY (environment, scope_id, strategy_account_id)
    REFERENCES finance_accounts(environment, scope_id, strategy_account_id)
);

CREATE OR REPLACE FUNCTION finance_reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'finance history is immutable'; END $$;
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['finance_source_events','finance_journal_transactions',
    'finance_journal_postings','finance_reconciliation_checkpoints','finance_command_claims',
    'finance_policy_versions','finance_calculation_receipts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', item, item);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION finance_reject_immutable_mutation()', item, item);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION finance_check_balanced_postings() RETURNS trigger
LANGUAGE plpgsql AS $$ DECLARE expected_count integer; actual_count integer; BEGIN
  SELECT posting_count INTO expected_count FROM finance_journal_transactions
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND transaction_id=NEW.transaction_id;
  SELECT count(*) INTO actual_count FROM finance_journal_postings
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND transaction_id=NEW.transaction_id;
  IF expected_count IS NULL OR actual_count <> expected_count
    OR EXISTS (SELECT asset_unit_id FROM finance_journal_postings
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND transaction_id=NEW.transaction_id
    GROUP BY asset_unit_id HAVING sum(units) <> 0) THEN
    RAISE EXCEPTION 'finance journal is not balanced by asset';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS finance_postings_balanced ON finance_journal_transactions;
CREATE CONSTRAINT TRIGGER finance_postings_balanced
  AFTER INSERT ON finance_journal_transactions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance_check_balanced_postings();
DROP TRIGGER IF EXISTS finance_posting_append_balanced ON finance_journal_postings;
CREATE CONSTRAINT TRIGGER finance_posting_append_balanced
  AFTER INSERT ON finance_journal_postings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance_check_balanced_postings();
COMMIT;
