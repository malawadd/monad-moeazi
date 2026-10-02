BEGIN;

-- Wall-clock leases remain in finance_accounts. This cursor is immutable replay
-- time, advanced only through the frozen source corpus and persisted commands.
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS replay_cursor_at timestamptz;
UPDATE simulation_runs SET replay_cursor_at =
  (manifest_json->'scenario'->>'simulation_cursor_at')::timestamptz
WHERE replay_cursor_at IS NULL;
ALTER TABLE simulation_runs ALTER COLUMN replay_cursor_at SET NOT NULL;

CREATE OR REPLACE FUNCTION simulation_guard_replay_cursor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE start_at timestamptz;
DECLARE end_at timestamptz;
BEGIN
  start_at := (NEW.manifest_json->'scenario'->>'simulation_cursor_at')::timestamptz;
  end_at := (NEW.manifest_json->'scenario'->>'simulation_end_at')::timestamptz;
  IF TG_OP = 'INSERT' AND NEW.replay_cursor_at IS NULL THEN
    NEW.replay_cursor_at := start_at;
  END IF;
  IF NEW.replay_cursor_at IS NULL OR start_at IS NULL OR end_at IS NULL OR
      NEW.replay_cursor_at < start_at OR NEW.replay_cursor_at > end_at THEN
    RAISE EXCEPTION 'simulation replay cursor escaped frozen run bounds';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.replay_cursor_at < OLD.replay_cursor_at THEN
    RAISE EXCEPTION 'simulation replay cursor cannot regress';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_runs_replay_cursor ON simulation_runs;
CREATE TRIGGER simulation_runs_replay_cursor BEFORE INSERT OR UPDATE
  ON simulation_runs FOR EACH ROW EXECUTE FUNCTION simulation_guard_replay_cursor();

-- The legacy projection columns are useful for quick risk checks. The exact
-- rational basis, fee identities, funding and margin state need a durable body.
ALTER TABLE simulation_positions
  ADD COLUMN IF NOT EXISTS arithmetic_state_json jsonb;
ALTER TABLE simulation_positions
  ADD COLUMN IF NOT EXISTS arithmetic_state_hash text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='simulation_position_arithmetic_pair') THEN
    ALTER TABLE simulation_positions ADD CONSTRAINT simulation_position_arithmetic_pair
      CHECK ((arithmetic_state_json IS NULL) = (arithmetic_state_hash IS NULL)
        AND (arithmetic_state_hash IS NULL OR
             arithmetic_state_hash ~ '^[a-f0-9]{64}$'));
  END IF;
END $$;

-- Optional first-order compatibility has no context row. Every later decision
-- has a frozen, server-resolved prefix, current account checkpoint and cursor.
CREATE TABLE IF NOT EXISTS simulation_decision_contexts (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL,
  decision_hash text NOT NULL CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  decision_json jsonb NOT NULL,
  instrument_version_id text NOT NULL,
  cursor_at timestamptz NOT NULL,
  evidence_cutoff_at timestamptz NOT NULL,
  evidence_snapshot_hash text NOT NULL CHECK (evidence_snapshot_hash ~ '^[a-f0-9]{64}$'),
  account_snapshot_hash text NOT NULL CHECK (account_snapshot_hash ~ '^[a-f0-9]{64}$'),
  dataset_prefix_count integer NOT NULL CHECK (dataset_prefix_count BETWEEN 1 AND 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,decision_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  FOREIGN KEY (evidence_snapshot_hash)
    REFERENCES observation_evidence_snapshots(snapshot_hash),
  FOREIGN KEY (account_snapshot_hash)
    REFERENCES observation_account_snapshots(snapshot_hash),
  CHECK (evidence_cutoff_at <= cursor_at),
  CHECK ((decision_json->>'decision_hash') IS NOT DISTINCT FROM decision_hash),
  CHECK ((decision_json->>'run_id') IS NOT DISTINCT FROM run_id),
  CHECK ((decision_json->'scope'->>'environment') IS NOT DISTINCT FROM environment),
  CHECK ((decision_json->'scope'->>'scope_id') IS NOT DISTINCT FROM scope_id),
  CHECK ((decision_json->'scope'->>'strategy_account_id')
         IS NOT DISTINCT FROM strategy_account_id),
  CHECK ((decision_json->>'instrument_version_id') IS NOT DISTINCT FROM instrument_version_id),
  CHECK ((decision_json->>'evidence_snapshot_hash') IS NOT DISTINCT FROM evidence_snapshot_hash),
  CHECK ((decision_json->>'account_snapshot_hash') IS NOT DISTINCT FROM account_snapshot_hash),
  CHECK ((decision_json->>'cursor_at')::timestamptz IS NOT DISTINCT FROM cursor_at),
  CHECK ((decision_json->>'evidence_cutoff_at')::timestamptz
         IS NOT DISTINCT FROM evidence_cutoff_at),
  CHECK ((decision_json->>'dataset_prefix_count')::integer
         IS NOT DISTINCT FROM dataset_prefix_count)
);

CREATE OR REPLACE FUNCTION simulation_guard_decision_context() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE run_manifest text;
DECLARE run_cursor timestamptz;
DECLARE current_snapshot text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'simulation decision context is immutable';
  END IF;
  SELECT manifest_hash,replay_cursor_at INTO run_manifest,run_cursor
  FROM simulation_runs WHERE environment=NEW.environment AND scope_id=NEW.scope_id
    AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id;
  SELECT observation_snapshot_hash INTO current_snapshot FROM finance_accounts
  WHERE environment=NEW.environment AND scope_id=NEW.scope_id
    AND strategy_account_id=NEW.strategy_account_id;
  IF run_manifest IS NULL OR run_cursor IS NULL OR current_snapshot IS NULL OR
      (NEW.decision_json->>'run_manifest_hash') IS DISTINCT FROM run_manifest OR
      NEW.cursor_at <> run_cursor OR
      NEW.account_snapshot_hash <> current_snapshot THEN
    RAISE EXCEPTION 'replay decision differs from current scoped run or account';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_decision_contexts_immutable
  ON simulation_decision_contexts;
CREATE TRIGGER simulation_decision_contexts_immutable BEFORE UPDATE OR DELETE
  ON simulation_decision_contexts FOR EACH ROW
  EXECUTE FUNCTION simulation_reject_immutable();
DROP TRIGGER IF EXISTS simulation_decision_contexts_insert_guard
  ON simulation_decision_contexts;
CREATE TRIGGER simulation_decision_contexts_insert_guard BEFORE INSERT
  ON simulation_decision_contexts FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_decision_context();

-- A source fact is not financially folded merely because it was materialized.
-- The journal, order/position state, event link and receipt commit together.
CREATE TABLE IF NOT EXISTS simulation_event_folds (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, order_id text NOT NULL,
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  event_kind text NOT NULL,
  transaction_id text,
  position_revision bigint CHECK (position_revision >= 0),
  folded_at_cursor timestamptz NOT NULL,
  folded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,event_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,event_hash)
    REFERENCES simulation_order_events
      (environment,scope_id,strategy_account_id,run_id,event_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,transaction_id)
    REFERENCES finance_journal_transactions
      (environment,scope_id,strategy_account_id,transaction_id),
  CHECK ((event_kind IN ('fill','funding')) = (transaction_id IS NOT NULL))
);

CREATE OR REPLACE FUNCTION simulation_guard_event_fold() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_kind text;
DECLARE source_cursor timestamptz;
DECLARE current_cursor timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'simulation event fold is immutable';
  END IF;
  SELECT kind,simulation_cursor_at INTO source_kind,source_cursor
  FROM simulation_order_events WHERE environment=NEW.environment
    AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
    AND run_id=NEW.run_id AND order_id=NEW.order_id AND event_hash=NEW.event_hash;
  SELECT replay_cursor_at INTO current_cursor FROM simulation_runs
  WHERE environment=NEW.environment AND scope_id=NEW.scope_id
    AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id;
  IF source_kind IS NULL OR current_cursor IS NULL OR
      source_kind <> NEW.event_kind OR
      source_cursor <> NEW.folded_at_cursor OR
      source_cursor > current_cursor THEN
    RAISE EXCEPTION 'simulation fold differs from durable source fact';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_event_folds_guard ON simulation_event_folds;
CREATE TRIGGER simulation_event_folds_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_event_folds FOR EACH ROW EXECUTE FUNCTION simulation_guard_event_fold();

-- A control is applied when persisted; this separate immutable receipt records
-- whether its requested cancellation/reduction was dispatched or resolved.
CREATE TABLE IF NOT EXISTS simulation_control_processing (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, command_id text NOT NULL,
  processing_kind text NOT NULL CHECK (processing_kind IN ('dispatched','resolved')),
  processed_at_cursor timestamptz NOT NULL,
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  result_json jsonb NOT NULL,
  target_order_id text,
  terminal_event_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,command_id,
               processing_kind),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,command_id)
    REFERENCES simulation_commands
      (environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,target_order_id)
    REFERENCES simulation_orders
      (environment,scope_id,strategy_account_id,run_id,order_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,terminal_event_hash)
    REFERENCES simulation_order_events
      (environment,scope_id,strategy_account_id,run_id,event_hash),
  CHECK ((result_json->>'resultHash') IS NOT DISTINCT FROM result_hash),
  CHECK ((result_json->>'commandId') IS NOT DISTINCT FROM command_id),
  CHECK ((result_json->>'processingKind') IS NOT DISTINCT FROM processing_kind)
);
DROP TRIGGER IF EXISTS simulation_control_processing_immutable
  ON simulation_control_processing;
CREATE TRIGGER simulation_control_processing_immutable BEFORE UPDATE OR DELETE
  ON simulation_control_processing FOR EACH ROW
  EXECUTE FUNCTION simulation_reject_immutable();

DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['simulation_decision_contexts','simulation_event_folds',
                             'simulation_control_processing'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item);
    EXECUTE format('DROP POLICY IF EXISTS simulation_preserve_existing_grants ON public.%I', item);
    EXECUTE format('CREATE POLICY simulation_preserve_existing_grants ON public.%I
      AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true)', item);
    EXECUTE format('DROP POLICY IF EXISTS simulation_experiment_only ON public.%I', item);
    EXECUTE format('CREATE POLICY simulation_experiment_only ON public.%I
      AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
      USING (environment = ''experiment'') WITH CHECK (environment = ''experiment'')', item);
    EXECUTE format('REVOKE ALL ON public.%I FROM moeazi_simulation_writer', item);
    EXECUTE format('GRANT SELECT,INSERT ON public.%I TO moeazi_simulation_writer', item);
  END LOOP;
END $$;

COMMIT;
