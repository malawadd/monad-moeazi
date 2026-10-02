BEGIN;

CREATE TABLE IF NOT EXISTS simulation_intents (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, intent_id text NOT NULL,
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  intent_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,intent_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,intent_id,intent_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  CHECK ((intent_json->>'intent_hash') IS NOT DISTINCT FROM intent_hash),
  CHECK ((intent_json->>'intent_id') IS NOT DISTINCT FROM intent_id)
);
DROP TRIGGER IF EXISTS simulation_intents_immutable ON simulation_intents;
CREATE TRIGGER simulation_intents_immutable BEFORE UPDATE OR DELETE ON simulation_intents
  FOR EACH ROW EXECUTE FUNCTION simulation_reject_immutable();

CREATE TABLE IF NOT EXISTS simulation_approval_receipts (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, approval_hash text NOT NULL CHECK (approval_hash ~ '^[a-f0-9]{64}$'),
  command_id text NOT NULL,
  intent_id text NOT NULL, intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  normalized_payload_hash text NOT NULL CHECK (normalized_payload_hash ~ '^[a-f0-9]{64}$'),
  approved_by_subject text NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  approval_json jsonb NOT NULL,
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,approval_hash),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,intent_id,intent_hash)
    REFERENCES simulation_intents(environment,scope_id,strategy_account_id,run_id,
      intent_id,intent_hash),
  CHECK (expires_at > approved_at),
  CHECK ((approval_json->>'approvalHash') IS NOT DISTINCT FROM approval_hash)
);
DROP TRIGGER IF EXISTS simulation_approval_receipts_immutable ON simulation_approval_receipts;
CREATE TRIGGER simulation_approval_receipts_immutable BEFORE UPDATE OR DELETE
  ON simulation_approval_receipts FOR EACH ROW EXECUTE FUNCTION simulation_reject_immutable();

CREATE TABLE IF NOT EXISTS simulation_approval_revocations (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, approval_hash text NOT NULL,
  revoked_by_subject text NOT NULL, revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,approval_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,approval_hash)
    REFERENCES simulation_approval_receipts(environment,scope_id,strategy_account_id,
      run_id,approval_hash)
);
DROP TRIGGER IF EXISTS simulation_approval_revocations_immutable ON simulation_approval_revocations;
CREATE TRIGGER simulation_approval_revocations_immutable BEFORE UPDATE OR DELETE
  ON simulation_approval_revocations FOR EACH ROW EXECUTE FUNCTION simulation_reject_immutable();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname =
      'simulation_orders_intent_identity_fk') THEN
    ALTER TABLE simulation_orders ADD CONSTRAINT simulation_orders_intent_identity_fk
      FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,intent_id,intent_hash)
      REFERENCES simulation_intents(environment,scope_id,strategy_account_id,
        run_id,intent_id,intent_hash);
  END IF;
END $$;

COMMIT;
