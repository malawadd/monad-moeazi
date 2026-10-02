BEGIN;

-- Repeated customer commands cannot create competing source timelines for one
-- economic order. Resolution is an additional immutable row, never an update.
CREATE UNIQUE INDEX IF NOT EXISTS simulation_one_cancel_dispatch_per_order
  ON simulation_control_processing(environment,scope_id,strategy_account_id,
    run_id,target_order_id)
  WHERE processing_kind='dispatched'
    AND result_json->>'operation'='request_cancel';

COMMIT;
