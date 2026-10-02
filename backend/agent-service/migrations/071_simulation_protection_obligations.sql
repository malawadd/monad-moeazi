BEGIN;

ALTER TABLE simulation_protections
  ADD COLUMN IF NOT EXISTS originating_event_hash text,
  ADD COLUMN IF NOT EXISTS intended_json jsonb;

-- No terminal/resolved status is introduced until a separate qualified flat-source
-- proof contract exists. Acceptance of a reduction request cannot clear exposure.
ALTER TABLE simulation_protections DROP CONSTRAINT IF EXISTS simulation_protection_obligation_shape;
ALTER TABLE simulation_protections ADD CONSTRAINT simulation_protection_obligation_shape CHECK (
  ((originating_event_hash IS NULL)=(intended_json IS NULL)) AND
  (originating_event_hash IS NULL OR (originating_event_hash ~ '^[a-f0-9]{64}$' AND
    jsonb_typeof(intended_json)='object' AND octet_length(intended_json::text)<=16384))
);
ALTER TABLE simulation_protections DROP CONSTRAINT IF EXISTS simulation_protection_originating_fact;
ALTER TABLE simulation_protections ADD CONSTRAINT simulation_protection_originating_fact
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id,originating_event_hash)
  REFERENCES simulation_order_events(environment,scope_id,strategy_account_id,run_id,event_hash);
CREATE UNIQUE INDEX IF NOT EXISTS simulation_one_obligation_per_fill
  ON simulation_protections(environment,scope_id,strategy_account_id,run_id,originating_event_hash)
  WHERE originating_event_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION simulation_guard_protection_obligation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'protection obligations cannot be deleted';
  END IF;
  IF TG_OP='INSERT' AND (NEW.originating_event_hash IS NULL OR NEW.intended_json IS NULL) THEN
    RAISE EXCEPTION 'new protection obligations require a fill-bound preimage';
  END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.environment,NEW.scope_id,NEW.strategy_account_id,
      NEW.run_id,NEW.protection_order_id,NEW.instrument_version_id,NEW.location_id,
      NEW.originating_order_id,NEW.policy_hash,NEW.intended_hash,
      NEW.originating_event_hash,NEW.intended_json) IS DISTINCT FROM
    ROW(OLD.environment,OLD.scope_id,OLD.strategy_account_id,
      OLD.run_id,OLD.protection_order_id,OLD.instrument_version_id,OLD.location_id,
      OLD.originating_order_id,OLD.policy_hash,OLD.intended_hash,
      OLD.originating_event_hash,OLD.intended_json)) THEN
    RAISE EXCEPTION 'protection origin is immutable';
  END IF;
  IF NEW.intended_json IS NOT NULL AND (
      NEW.intended_json->>'intended_hash' IS DISTINCT FROM NEW.intended_hash OR
      NEW.intended_json->>'protection_order_id' IS DISTINCT FROM NEW.protection_order_id OR
      NEW.intended_json->>'originating_event_hash' IS DISTINCT FROM NEW.originating_event_hash OR
      NEW.intended_json->>'originating_order_id' IS DISTINCT FROM NEW.originating_order_id OR
      NEW.intended_json->>'run_id' IS DISTINCT FROM NEW.run_id OR
      NEW.intended_json->>'instrument_version_id' IS DISTINCT FROM NEW.instrument_version_id OR
      NEW.intended_json->>'location_id' IS DISTINCT FROM NEW.location_id OR
      NEW.intended_json->>'policy_hash' IS DISTINCT FROM NEW.policy_hash OR
      NEW.intended_json->'scope' IS DISTINCT FROM jsonb_build_object(
        'environment',NEW.environment,'scope_id',NEW.scope_id,
        'strategy_account_id',NEW.strategy_account_id)) THEN
    RAISE EXCEPTION 'protection obligation body differs from its identity';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_protection_obligations_guard ON simulation_protections;
CREATE TRIGGER simulation_protection_obligations_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_protections FOR EACH ROW EXECUTE FUNCTION simulation_guard_protection_obligation();

-- The fill fold writes its receipt after its position/obligation effects. Check the
-- complete atomic relationship at transaction end, not before those inserts exist.
CREATE OR REPLACE FUNCTION simulation_check_protection_origin() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.originating_event_hash IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM simulation_order_events e
    JOIN simulation_event_folds f USING(environment,scope_id,strategy_account_id,run_id,event_hash)
    JOIN simulation_orders o ON o.environment=e.environment AND o.scope_id=e.scope_id
      AND o.strategy_account_id=e.strategy_account_id AND o.run_id=e.run_id AND o.order_id=e.order_id
    JOIN simulation_intents i ON i.environment=o.environment AND i.scope_id=o.scope_id
      AND i.strategy_account_id=o.strategy_account_id AND i.run_id=o.run_id AND i.intent_id=o.intent_id
    WHERE e.environment=NEW.environment AND e.scope_id=NEW.scope_id
      AND e.strategy_account_id=NEW.strategy_account_id AND e.run_id=NEW.run_id
      AND e.event_hash=NEW.originating_event_hash AND e.kind='fill' AND f.event_kind='fill'
      AND f.transaction_id IS NOT NULL AND e.order_id=NEW.originating_order_id
      AND o.action IN ('spot_buy','perp_open','perp_increase')
      AND o.instrument_version_id=NEW.instrument_version_id
      AND i.intent_json->'protection'->>'required'='true'
      AND i.intent_json->'protection'->>'policy_hash'=NEW.policy_hash
      AND o.permit_hash=NEW.intended_json->>'originating_permit_hash'
      AND i.intent_hash=NEW.intended_json->>'originating_intent_hash'
      AND f.position_revision=(NEW.intended_json->>'position_revision')::bigint
      AND e.event_json->>'fill_quantity_units'=NEW.intended_json->>'filled_quantity_units'
  ) THEN
    RAISE EXCEPTION 'protection origin lacks its folded increasing source fill';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_protection_origin_check ON simulation_protections;
CREATE CONSTRAINT TRIGGER simulation_protection_origin_check AFTER INSERT
  ON simulation_protections DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION simulation_check_protection_origin();

COMMIT;
