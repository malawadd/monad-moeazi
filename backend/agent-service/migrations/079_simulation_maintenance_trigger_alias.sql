BEGIN;

-- Correct the table alias that collided with PL/pgSQL's trigger OLD record.
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
  IF EXISTS (SELECT 1 FROM simulation_maintenance_reductions prior_m
    LEFT JOIN simulation_orders o ON o.environment=prior_m.environment
      AND o.scope_id=prior_m.scope_id AND o.strategy_account_id=prior_m.strategy_account_id
      AND o.run_id=prior_m.run_id AND o.order_id=prior_m.maintenance_order_id
    LEFT JOIN finance_reservations h ON h.environment=prior_m.environment
      AND h.scope_id=prior_m.scope_id AND h.strategy_account_id=prior_m.strategy_account_id
      AND h.reservation_id=prior_m.reservation_id
    LEFT JOIN simulation_reservation_resolutions z ON z.environment=prior_m.environment
      AND z.scope_id=prior_m.scope_id AND z.strategy_account_id=prior_m.strategy_account_id
      AND z.run_id=prior_m.run_id AND z.order_id=prior_m.maintenance_order_id
    WHERE prior_m.environment=NEW.environment AND prior_m.scope_id=NEW.scope_id
      AND prior_m.strategy_account_id=NEW.strategy_account_id AND prior_m.run_id=NEW.run_id
      AND prior_m.instrument_version_id=NEW.instrument_version_id
      AND prior_m.location_id=NEW.location_id
      AND (o.order_id IS NULL OR o.status NOT IN ('filled','cancelled','rejected')
        OR o.permit_json->>'maintenance_receipt_hash' IS DISTINCT FROM prior_m.receipt_hash
        OR o.terminal_event_hash IS NULL OR h.status NOT IN ('settled','released')
        OR h.resolution_proof_hash IS NULL OR z.reservation_id IS NULL
        OR z.reservation_id IS DISTINCT FROM prior_m.reservation_id
        OR z.resolution_hash IS DISTINCT FROM h.resolution_proof_hash
        OR z.terminal_event_hash IS DISTINCT FROM o.terminal_event_hash
        OR z.terminal_order_status IS DISTINCT FROM o.status
        OR z.calculation_receipt_hash IS DISTINCT FROM prior_m.sizing_receipt_hash
        OR z.cumulative_filled_units IS DISTINCT FROM o.cumulative_filled_units)) THEN
    RAISE EXCEPTION 'prior maintenance attempt has unresolved source or capacity';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
