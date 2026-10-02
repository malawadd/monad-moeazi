BEGIN;

ALTER TABLE simulation_maintenance_reductions
  ADD COLUMN IF NOT EXISTS authority_epoch bigint;
ALTER TABLE simulation_maintenance_reductions
  DROP CONSTRAINT IF EXISTS simulation_maintenance_epoch_shape;
ALTER TABLE simulation_maintenance_reductions
  ADD CONSTRAINT simulation_maintenance_epoch_shape CHECK (
    authority_epoch IS NOT NULL AND authority_epoch>=0 AND
    (receipt_json->>'authority_epoch')::bigint IS NOT DISTINCT FROM authority_epoch);

-- An immutable close mandate may be retried only after every older attempt on
-- the same scoped position has a terminal, folded, proof-settled disposition.
-- The source-bound protection obligations themselves remain unresolved.
CREATE OR REPLACE FUNCTION simulation_guard_maintenance_reattempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finance_accounts a
    JOIN finance_reservations h USING(environment,scope_id,strategy_account_id)
    JOIN finance_calculation_receipts q ON q.environment=h.environment
      AND q.scope_id=h.scope_id AND q.strategy_account_id=h.strategy_account_id
      AND q.receipt_hash=h.calculation_receipt_hash
    JOIN simulation_intents i ON i.environment=a.environment
      AND i.scope_id=a.scope_id AND i.strategy_account_id=a.strategy_account_id
      AND i.run_id=NEW.run_id AND i.intent_id=NEW.intent_id
    WHERE a.environment=NEW.environment AND a.scope_id=NEW.scope_id
      AND a.strategy_account_id=NEW.strategy_account_id
      AND a.authority_epoch=NEW.authority_epoch
      AND a.admission_state IN ('open','stopped')
      AND a.reconciliation_state='clean'
      AND h.reservation_id=NEW.reservation_id
      AND h.authority_epoch=NEW.authority_epoch
      AND q.receipt_json->>'request_id'='maintenance:'||NEW.command_hash
      AND i.intent_hash=NEW.intent_hash
      AND i.intent_json->>'maintenance_command_hash'=NEW.command_hash) THEN
    RAISE EXCEPTION 'maintenance authority epoch or scoped request changed';
  END IF;
  IF EXISTS (SELECT 1 FROM simulation_maintenance_reductions old
    LEFT JOIN simulation_orders o ON o.environment=old.environment
      AND o.scope_id=old.scope_id AND o.strategy_account_id=old.strategy_account_id
      AND o.run_id=old.run_id AND o.order_id=old.maintenance_order_id
    LEFT JOIN finance_reservations h ON h.environment=old.environment
      AND h.scope_id=old.scope_id AND h.strategy_account_id=old.strategy_account_id
      AND h.reservation_id=old.reservation_id
    LEFT JOIN simulation_reservation_resolutions z ON z.environment=old.environment
      AND z.scope_id=old.scope_id AND z.strategy_account_id=old.strategy_account_id
      AND z.run_id=old.run_id AND z.order_id=old.maintenance_order_id
    WHERE old.environment=NEW.environment AND old.scope_id=NEW.scope_id
      AND old.strategy_account_id=NEW.strategy_account_id AND old.run_id=NEW.run_id
      AND old.instrument_version_id=NEW.instrument_version_id
      AND old.location_id=NEW.location_id
      AND (o.order_id IS NULL OR o.status NOT IN ('filled','cancelled','rejected')
        OR o.permit_json->>'maintenance_receipt_hash' IS DISTINCT FROM old.receipt_hash
        OR o.terminal_event_hash IS NULL OR h.status NOT IN ('settled','released')
        OR h.resolution_proof_hash IS NULL OR z.reservation_id IS NULL
        OR z.reservation_id IS DISTINCT FROM old.reservation_id
        OR z.resolution_hash IS DISTINCT FROM h.resolution_proof_hash
        OR z.terminal_event_hash IS DISTINCT FROM o.terminal_event_hash
        OR z.terminal_order_status IS DISTINCT FROM o.status
        OR z.calculation_receipt_hash IS DISTINCT FROM old.sizing_receipt_hash
        OR z.cumulative_filled_units IS DISTINCT FROM o.cumulative_filled_units)) THEN
    RAISE EXCEPTION 'prior maintenance attempt has unresolved source or capacity';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_maintenance_reattempt
  ON simulation_maintenance_reductions;
CREATE TRIGGER simulation_maintenance_reattempt BEFORE INSERT
  ON simulation_maintenance_reductions FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_maintenance_reattempt();

-- The durable submitted order must carry the exact close mandate. This is a
-- structural link; the application also rehashes the full DTO under its lock.
CREATE OR REPLACE FUNCTION simulation_guard_maintenance_order()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mandate record; origin text;
BEGIN
  IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
  IF NEW.permit_json->>'maintenance_receipt_hash' IS NULL AND NOT EXISTS (
    SELECT 1 FROM simulation_maintenance_reductions m
    WHERE m.environment=NEW.environment AND m.scope_id=NEW.scope_id
      AND m.strategy_account_id=NEW.strategy_account_id AND m.run_id=NEW.run_id
      AND m.maintenance_order_id=NEW.order_id) THEN
    IF NEW.permit_json->>'protection_order_id'=NEW.order_id AND NOT EXISTS (
      SELECT 1 FROM simulation_protections p WHERE p.environment=NEW.environment
        AND p.scope_id=NEW.scope_id AND p.strategy_account_id=NEW.strategy_account_id
        AND p.run_id=NEW.run_id AND p.protection_order_id=NEW.order_id
        AND p.originating_order_id=NEW.permit_json->>'originating_order_id'
        AND p.resolution_hash IS NULL) THEN
      RAISE EXCEPTION 'protective order lacks immutable source obligation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO mandate FROM simulation_maintenance_reductions m
    WHERE m.environment=NEW.environment AND m.scope_id=NEW.scope_id
      AND m.strategy_account_id=NEW.strategy_account_id AND m.run_id=NEW.run_id
      AND m.maintenance_order_id=NEW.order_id
      AND m.receipt_hash=NEW.permit_json->>'maintenance_receipt_hash';
  IF mandate.receipt_hash IS NULL THEN
    RAISE EXCEPTION 'maintenance order lacks its immutable close mandate';
  END IF;
  SELECT p.originating_order_id INTO origin FROM simulation_protections p
    WHERE p.environment=NEW.environment AND p.scope_id=NEW.scope_id
      AND p.strategy_account_id=NEW.strategy_account_id AND p.run_id=NEW.run_id
      AND p.protection_order_id=mandate.anchor_protection_order_id
      AND p.resolution_hash IS NULL;
  IF origin IS NULL OR
      NEW.intent_id IS DISTINCT FROM mandate.intent_id OR
      NEW.intent_hash IS DISTINCT FROM mandate.intent_hash OR
      NEW.reservation_id IS DISTINCT FROM mandate.reservation_id OR
      NEW.instrument_version_id IS DISTINCT FROM mandate.instrument_version_id OR
      NEW.action IS DISTINCT FROM mandate.reduction_action OR
      NEW.side IS DISTINCT FROM mandate.side OR
      NEW.quantity_units IS DISTINCT FROM mandate.quantity_units OR
      NEW.permit_json->>'run_manifest_hash' IS DISTINCT FROM mandate.manifest_hash OR
      NEW.permit_json->'controller_ref' IS DISTINCT FROM
        mandate.receipt_json->'controller_ref' OR
      NEW.permit_json->>'location_id' IS DISTINCT FROM mandate.location_id OR
      NEW.permit_json->>'decision_context_hash' IS DISTINCT FROM mandate.decision_hash OR
      (NEW.permit_json->>'authority_epoch')::bigint
        IS DISTINCT FROM mandate.authority_epoch OR
      NEW.permit_json->>'protection_order_id' IS DISTINCT FROM NEW.order_id OR
      NEW.permit_json->>'originating_order_id' IS DISTINCT FROM origin OR
      NEW.permit_json->>'approval_receipt_hash' IS NOT NULL OR
      NEW.permit_json->'execution_envelope'->>'envelope_hash'
        IS DISTINCT FROM mandate.execution_envelope_hash THEN
    RAISE EXCEPTION 'maintenance order differs from authenticated close mandate';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_maintenance_order_binding ON simulation_orders;
CREATE TRIGGER simulation_maintenance_order_binding BEFORE INSERT ON simulation_orders
  FOR EACH ROW EXECUTE FUNCTION simulation_guard_maintenance_order();

COMMIT;
