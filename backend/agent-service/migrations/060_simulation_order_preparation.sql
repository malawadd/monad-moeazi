BEGIN;

-- Approval targets this server-prepared economic payload, never a caller hash.
CREATE TABLE IF NOT EXISTS simulation_order_preparations (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL, run_id text NOT NULL,
  order_id text NOT NULL, order_ordinal bigint NOT NULL CHECK (order_ordinal > 0),
  intent_id text NOT NULL, intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  reservation_id text NOT NULL, calculation_receipt_hash text NOT NULL
    CHECK (calculation_receipt_hash ~ '^[a-f0-9]{64}$'),
  normalized_payload_hash text NOT NULL CHECK (normalized_payload_hash ~ '^[a-f0-9]{64}$'),
  normalized_payload_json jsonb NOT NULL,
  client_id text NOT NULL, attempt_id text NOT NULL,
  quantity_units finance_native_units NOT NULL CHECK (quantity_units > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,order_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,order_ordinal),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,intent_id,intent_hash,
    normalized_payload_hash),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,order_id,order_ordinal,
    intent_id,intent_hash,reservation_id,normalized_payload_hash,client_id,
    attempt_id,quantity_units),
  UNIQUE (environment,scope_id,strategy_account_id,client_id),
  UNIQUE (environment,scope_id,strategy_account_id,attempt_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,intent_id,intent_hash)
    REFERENCES simulation_intents(environment,scope_id,strategy_account_id,run_id,
      intent_id,intent_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,reservation_id)
    REFERENCES finance_reservations(environment,scope_id,strategy_account_id,reservation_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,calculation_receipt_hash)
    REFERENCES finance_calculation_receipts(environment,scope_id,strategy_account_id,receipt_hash),
  CHECK ((normalized_payload_json->>'normalizedPayloadHash')
    IS NOT DISTINCT FROM normalized_payload_hash),
  CHECK ((normalized_payload_json->>'orderId') IS NOT DISTINCT FROM order_id),
  CHECK ((normalized_payload_json->>'intentHash') IS NOT DISTINCT FROM intent_hash)
);
DROP TRIGGER IF EXISTS simulation_order_preparations_immutable
  ON simulation_order_preparations;
CREATE TRIGGER simulation_order_preparations_immutable BEFORE UPDATE OR DELETE
  ON simulation_order_preparations FOR EACH ROW EXECUTE FUNCTION simulation_reject_immutable();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname =
      'simulation_orders_preparation_fk') THEN
    ALTER TABLE simulation_orders ADD CONSTRAINT simulation_orders_preparation_fk
      FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,order_id,
        order_ordinal,intent_id,intent_hash,reservation_id,normalized_payload_hash,
        client_id,attempt_id,quantity_units)
      REFERENCES simulation_order_preparations(environment,scope_id,
        strategy_account_id,run_id,order_id,order_ordinal,intent_id,intent_hash,
        reservation_id,normalized_payload_hash,client_id,attempt_id,quantity_units);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname =
      'simulation_approvals_preparation_fk') THEN
    ALTER TABLE simulation_approval_receipts ADD CONSTRAINT simulation_approvals_preparation_fk
      FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,intent_id,
        intent_hash,normalized_payload_hash)
      REFERENCES simulation_order_preparations(environment,scope_id,
        strategy_account_id,run_id,intent_id,intent_hash,normalized_payload_hash);
  END IF;
END $$;

COMMIT;
