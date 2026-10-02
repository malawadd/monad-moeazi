BEGIN;

-- One immutable, source-backed final disposition for a simulated order hold.
-- The application proves source/journal/checkpoint roots in the same account-
-- locked transaction that changes the reservation and financial projection.
CREATE TABLE IF NOT EXISTS simulation_reservation_resolutions (
  environment text NOT NULL CHECK (environment='experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, reservation_id text NOT NULL,
  order_id text NOT NULL, command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  permit_hash text NOT NULL CHECK (permit_hash ~ '^[a-f0-9]{64}$'),
  calculation_receipt_hash text NOT NULL CHECK (calculation_receipt_hash ~ '^[a-f0-9]{64}$'),
  terminal_event_hash text NOT NULL CHECK (terminal_event_hash ~ '^[a-f0-9]{64}$'),
  terminal_order_status text NOT NULL CHECK (terminal_order_status IN
    ('filled','cancelled','rejected')),
  cumulative_filled_units finance_native_units NOT NULL CHECK (cumulative_filled_units >= 0),
  disposition text NOT NULL CHECK (disposition IN ('settled','released')),
  source_root text NOT NULL CHECK (source_root ~ '^[a-f0-9]{64}$'),
  journal_root text NOT NULL CHECK (journal_root ~ '^[a-f0-9]{64}$'),
  position_root text NOT NULL CHECK (position_root ~ '^[a-f0-9]{64}$'),
  account_snapshot_hash text NOT NULL CHECK (account_snapshot_hash ~ '^[a-f0-9]{64}$'),
  replay_cursor_at timestamptz NOT NULL,
  account_revision_before bigint NOT NULL CHECK (account_revision_before >= 0),
  account_revision_after bigint NOT NULL CHECK
    (account_revision_after = account_revision_before + 1),
  resolution_hash text NOT NULL CHECK (resolution_hash ~ '^[a-f0-9]{64}$'),
  resolution_json jsonb NOT NULL CHECK (jsonb_typeof(resolution_json)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,reservation_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,order_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,reservation_id)
    REFERENCES finance_reservations(environment,scope_id,strategy_account_id,reservation_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,order_id)
    REFERENCES simulation_orders(environment,scope_id,strategy_account_id,run_id,order_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,terminal_event_hash)
    REFERENCES simulation_order_events(environment,scope_id,strategy_account_id,
      run_id,event_hash),
  CHECK ((disposition='released') = (cumulative_filled_units=0)),
  CHECK ((resolution_json->>'resolutionHash') IS NOT DISTINCT FROM resolution_hash),
  CHECK ((resolution_json->>'reservationId') IS NOT DISTINCT FROM reservation_id),
  CHECK ((resolution_json->>'orderId') IS NOT DISTINCT FROM order_id),
  CHECK ((resolution_json->>'manifestHash') IS NOT DISTINCT FROM manifest_hash),
  CHECK ((resolution_json->>'permitHash') IS NOT DISTINCT FROM permit_hash),
  CHECK ((resolution_json->>'terminalEventHash') IS NOT DISTINCT FROM terminal_event_hash),
  CHECK ((resolution_json->>'accountSnapshotHash') IS NOT DISTINCT FROM account_snapshot_hash),
  CHECK ((resolution_json->>'runId') IS NOT DISTINCT FROM run_id),
  CHECK ((resolution_json->>'commandId') IS NOT DISTINCT FROM command_id),
  CHECK ((resolution_json->>'calculationReceiptHash') IS NOT DISTINCT FROM calculation_receipt_hash),
  CHECK ((resolution_json->>'terminalOrderStatus') IS NOT DISTINCT FROM terminal_order_status),
  CHECK ((resolution_json->>'disposition') IS NOT DISTINCT FROM disposition),
  CHECK ((resolution_json->>'sourceRoot') IS NOT DISTINCT FROM source_root),
  CHECK ((resolution_json->>'journalRoot') IS NOT DISTINCT FROM journal_root),
  CHECK ((resolution_json->>'positionRoot') IS NOT DISTINCT FROM position_root),
  CHECK ((resolution_json->>'cumulativeFilledUnits')::numeric
    IS NOT DISTINCT FROM cumulative_filled_units),
  CHECK ((resolution_json->>'replayCursorAt')::timestamptz
    IS NOT DISTINCT FROM replay_cursor_at),
  CHECK ((resolution_json->>'accountRevisionBefore')::bigint
    IS NOT DISTINCT FROM account_revision_before),
  CHECK ((resolution_json->>'accountRevisionAfter')::bigint
    IS NOT DISTINCT FROM account_revision_after),
  CHECK ((resolution_json->'scope'->>'environment') IS NOT DISTINCT FROM environment),
  CHECK ((resolution_json->'scope'->>'scope_id') IS NOT DISTINCT FROM scope_id),
  CHECK ((resolution_json->'scope'->>'strategy_account_id')
    IS NOT DISTINCT FROM strategy_account_id),
  CHECK (octet_length(resolution_json::text) <= 131072)
);

CREATE OR REPLACE FUNCTION simulation_guard_reservation_resolution()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_row record; order_row record; prep_row record; hold_row record;
  fact_row record; fold_row record; account_row record; checkpoint_row record;
  derived_row record; economic_folds boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'simulation reservation resolution is immutable';
  END IF;
  SELECT manifest_hash,replay_cursor_at,manifest_json->>'account_snapshot_hash' AS baseline
    INTO run_row FROM simulation_runs
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id;
  SELECT reservation_id,permit_hash,status,terminal_event_hash,quantity_units,
    cumulative_filled_units INTO order_row FROM simulation_orders
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
      AND order_id=NEW.order_id;
  SELECT reservation_id,calculation_receipt_hash INTO prep_row
    FROM simulation_order_preparations WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
      AND run_id=NEW.run_id AND order_id=NEW.order_id;
  SELECT calculation_receipt_hash,status,resolution_proof_hash
    INTO hold_row FROM finance_reservations
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id
      AND reservation_id=NEW.reservation_id;
  SELECT order_id,kind,simulation_cursor_at,event_json INTO fact_row
    FROM simulation_order_events WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
      AND run_id=NEW.run_id AND event_hash=NEW.terminal_event_hash;
  SELECT order_id,event_kind,transaction_id INTO fold_row
    FROM simulation_event_folds WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
      AND run_id=NEW.run_id AND event_hash=NEW.terminal_event_hash;
  SELECT revision,observation_snapshot_hash,reconciliation_state,
    reconciliation_reason INTO account_row FROM finance_accounts
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id;
  SELECT observation_snapshot_hash,journal_root_hash,result,reason INTO checkpoint_row
    FROM finance_reconciliation_checkpoints
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id
      AND account_revision=NEW.account_revision_after;
  SELECT snapshot_hash,source_root,journal_root,position_root,replay_cursor_at
    INTO derived_row FROM simulation_derived_snapshots
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
      AND snapshot_hash=NEW.account_snapshot_hash;
  SELECT EXISTS (SELECT 1 FROM simulation_event_folds f WHERE
      f.environment=NEW.environment AND f.scope_id=NEW.scope_id AND
      f.strategy_account_id=NEW.strategy_account_id AND f.run_id=NEW.run_id AND
      f.transaction_id IS NOT NULL) INTO economic_folds;
  IF run_row.manifest_hash IS DISTINCT FROM NEW.manifest_hash OR
      run_row.replay_cursor_at IS DISTINCT FROM NEW.replay_cursor_at OR
      run_row.baseline IS NULL OR
      order_row.reservation_id IS DISTINCT FROM NEW.reservation_id OR
      prep_row.reservation_id IS DISTINCT FROM NEW.reservation_id OR
      order_row.permit_hash IS DISTINCT FROM NEW.permit_hash OR
      order_row.status IS DISTINCT FROM NEW.terminal_order_status OR
      order_row.terminal_event_hash IS DISTINCT FROM NEW.terminal_event_hash OR
      order_row.cumulative_filled_units IS DISTINCT FROM NEW.cumulative_filled_units OR
      hold_row.calculation_receipt_hash IS DISTINCT FROM NEW.calculation_receipt_hash OR
      prep_row.calculation_receipt_hash IS DISTINCT FROM NEW.calculation_receipt_hash OR
      hold_row.status IS DISTINCT FROM NEW.disposition OR
      hold_row.resolution_proof_hash IS DISTINCT FROM NEW.resolution_hash OR
      fact_row.order_id IS DISTINCT FROM NEW.order_id OR
      (fact_row.event_json->>'permit_hash') IS DISTINCT FROM NEW.permit_hash OR
      (fact_row.event_json->>'cumulative_filled_units')::numeric
        IS DISTINCT FROM NEW.cumulative_filled_units OR
      fact_row.simulation_cursor_at > NEW.replay_cursor_at OR
      fold_row.order_id IS DISTINCT FROM NEW.order_id OR
      fold_row.event_kind IS DISTINCT FROM fact_row.kind OR
      (fact_row.kind='fill' AND fold_row.transaction_id IS NULL) OR
      account_row.revision IS DISTINCT FROM NEW.account_revision_after OR
      account_row.observation_snapshot_hash IS DISTINCT FROM NEW.account_snapshot_hash OR
      checkpoint_row.observation_snapshot_hash IS DISTINCT FROM NEW.account_snapshot_hash OR
      checkpoint_row.journal_root_hash IS DISTINCT FROM NEW.journal_root OR
      checkpoint_row.result IS DISTINCT FROM account_row.reconciliation_state OR
      checkpoint_row.reason IS DISTINCT FROM account_row.reconciliation_reason OR
      (account_row.reconciliation_state='clean' OR
        (account_row.reconciliation_state='quarantined' AND
         account_row.reconciliation_reason='reserved_capacity_exceeds_observed')) IS NOT TRUE OR
      (NEW.terminal_order_status='filled' AND
        (NEW.cumulative_filled_units IS DISTINCT FROM order_row.quantity_units OR
         fact_row.kind IS DISTINCT FROM 'fill')) OR
      (NEW.terminal_order_status='cancelled' AND fact_row.kind IS DISTINCT FROM 'cancelled') OR
      (NEW.terminal_order_status='rejected' AND fact_row.kind NOT IN
        ('rejected','protection_rejected')) THEN
    RAISE EXCEPTION 'simulation resolution differs from terminal economic source';
  END IF;
  IF economic_folds THEN
    IF derived_row.snapshot_hash IS DISTINCT FROM NEW.account_snapshot_hash OR
        derived_row.source_root IS DISTINCT FROM NEW.source_root OR
        derived_row.journal_root IS DISTINCT FROM NEW.journal_root OR
        derived_row.position_root IS DISTINCT FROM NEW.position_root OR
        derived_row.replay_cursor_at IS DISTINCT FROM NEW.replay_cursor_at THEN
      RAISE EXCEPTION 'simulation economic resolution lacks exact derived checkpoint';
    END IF;
  ELSIF NEW.account_snapshot_hash IS DISTINCT FROM run_row.baseline THEN
    RAISE EXCEPTION 'zero-fill resolution must retain opening snapshot';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_reservation_resolutions_guard
  ON simulation_reservation_resolutions;
CREATE TRIGGER simulation_reservation_resolutions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON simulation_reservation_resolutions
  FOR EACH ROW EXECUTE FUNCTION simulation_guard_reservation_resolution();

ALTER TABLE simulation_reservation_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants
  ON simulation_reservation_resolutions;
CREATE POLICY simulation_preserve_existing_grants ON simulation_reservation_resolutions
  AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS simulation_experiment_only
  ON simulation_reservation_resolutions;
CREATE POLICY simulation_experiment_only ON simulation_reservation_resolutions
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING (environment='experiment') WITH CHECK (environment='experiment');
REVOKE ALL ON simulation_reservation_resolutions FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_reservation_resolutions TO moeazi_simulation_writer;

COMMIT;
