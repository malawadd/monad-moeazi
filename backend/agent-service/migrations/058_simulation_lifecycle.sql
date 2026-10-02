BEGIN;

-- Experimental order authority is scoped to the ordinary PostgreSQL financial
-- account. The journal in 055 remains the only operational balance writer.
CREATE TABLE IF NOT EXISTS simulation_runs (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  registration_key text NOT NULL,
  manifest_json jsonb NOT NULL, scenario_hash text NOT NULL CHECK (scenario_hash ~ '^[a-f0-9]{64}$'),
  created_by_subject text NOT NULL, experiment_request_hash text NOT NULL
    CHECK (experiment_request_hash ~ '^[a-f0-9]{64}$'),
  authority_fingerprint text NOT NULL CHECK (authority_fingerprint ~ '^[a-f0-9]{64}$'),
  authority_epoch bigint NOT NULL CHECK (authority_epoch >= 0),
  status text NOT NULL CHECK (status IN ('registered','running','awaiting_evidence',
    'awaiting_protection','stopped_with_exposure','quarantined','completed_flat')),
  cursor_sequence bigint NOT NULL DEFAULT 0 CHECK (cursor_sequence >= 0),
  projection_revision bigint NOT NULL DEFAULT 0 CHECK (projection_revision >= 0),
  entries_stopped boolean NOT NULL DEFAULT false,
  pending_obligations boolean NOT NULL DEFAULT false,
  next_wake_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id),
  UNIQUE (environment,scope_id,strategy_account_id,manifest_hash),
  UNIQUE (environment,scope_id,strategy_account_id,registration_key),
  FOREIGN KEY (environment,scope_id,strategy_account_id)
    REFERENCES finance_accounts(environment,scope_id,strategy_account_id),
  CHECK ((manifest_json->>'manifest_hash') IS NOT DISTINCT FROM manifest_hash),
  CHECK (status <> 'completed_flat' OR NOT pending_obligations)
);

CREATE TABLE IF NOT EXISTS simulation_orders (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, order_id text NOT NULL, order_ordinal bigint NOT NULL CHECK (order_ordinal > 0),
  intent_id text NOT NULL, intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  permit_hash text NOT NULL CHECK (permit_hash ~ '^[a-f0-9]{64}$'),
  permit_json jsonb NOT NULL, client_id text NOT NULL, attempt_id text NOT NULL,
  reservation_id text NOT NULL, normalized_payload_hash text NOT NULL
    CHECK (normalized_payload_hash ~ '^[a-f0-9]{64}$'),
  instrument_version_id text NOT NULL, action text NOT NULL, side text NOT NULL,
  quantity_kind text NOT NULL CHECK (quantity_kind IN ('asset_native','contracts')),
  quantity_units finance_native_units NOT NULL CHECK (quantity_units > 0),
  cumulative_filled_units finance_native_units NOT NULL DEFAULT 0
    CHECK (cumulative_filled_units >= 0),
  status text NOT NULL CHECK (status IN ('prepared','submission_possible','accepted',
    'partially_filled','filled','cancel_requested','cancelled','rejected','uncertain')),
  terminal_event_hash text CHECK (terminal_event_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,order_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,order_ordinal),
  UNIQUE (environment,scope_id,strategy_account_id,client_id),
  UNIQUE (environment,scope_id,strategy_account_id,attempt_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,reservation_id)
    REFERENCES finance_reservations(environment,scope_id,strategy_account_id,reservation_id),
  CHECK (cumulative_filled_units <= quantity_units),
  CHECK ((permit_json->>'permit_hash') IS NOT DISTINCT FROM permit_hash),
  CHECK ((permit_json->>'order_id') IS NOT DISTINCT FROM order_id)
);

CREATE TABLE IF NOT EXISTS simulation_order_events (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, order_id text NOT NULL,
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  source_stream text NOT NULL, source_event_id text NOT NULL,
  source_revision text NOT NULL, sequence bigint NOT NULL CHECK (sequence >= 0),
  kind text NOT NULL, event_at timestamptz NOT NULL, available_at timestamptz NOT NULL,
  simulation_cursor_at timestamptz NOT NULL,
  event_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,event_hash),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,source_stream,source_event_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,order_id,source_stream,sequence),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,order_id)
    REFERENCES simulation_orders(environment,scope_id,strategy_account_id,run_id,order_id),
  CHECK ((event_json->>'event_hash') IS NOT DISTINCT FROM event_hash),
  CHECK (event_at <= available_at AND available_at <= simulation_cursor_at)
);
CREATE INDEX IF NOT EXISTS simulation_events_by_order ON simulation_order_events
  (environment,scope_id,strategy_account_id,run_id,order_id,sequence);

CREATE TABLE IF NOT EXISTS simulation_event_journal_links (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, event_hash text NOT NULL, transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,event_hash),
  UNIQUE (environment,scope_id,strategy_account_id,transaction_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,event_hash)
    REFERENCES simulation_order_events(environment,scope_id,strategy_account_id,run_id,event_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,transaction_id)
    REFERENCES finance_journal_transactions(environment,scope_id,strategy_account_id,transaction_id)
);

CREATE TABLE IF NOT EXISTS simulation_positions (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, instrument_version_id text NOT NULL, location_id text NOT NULL,
  originating_controller_ref jsonb NOT NULL, management_controller_ref jsonb NOT NULL,
  quantity_kind text NOT NULL CHECK (quantity_kind IN ('asset_native','contracts')),
  signed_exposure_units finance_native_units NOT NULL DEFAULT 0,
  attributed_filled_units finance_native_units NOT NULL DEFAULT 0 CHECK (attributed_filled_units >= 0),
  cost_basis_numerator finance_native_units NOT NULL DEFAULT 0,
  cost_basis_denominator finance_native_units NOT NULL DEFAULT 1 CHECK (cost_basis_denominator > 0),
  realized_pnl_numerator finance_native_units NOT NULL DEFAULT 0,
  realized_pnl_denominator finance_native_units NOT NULL DEFAULT 1 CHECK (realized_pnl_denominator > 0),
  collateral_asset_unit_id text, collateral_units finance_native_units NOT NULL DEFAULT 0
    CHECK (collateral_units >= 0),
  reconciliation_state text NOT NULL CHECK (reconciliation_state IN ('clean','awaiting_events',
    'awaiting_journal','awaiting_checkpoint','unknown','quarantined')),
  pending_obligations boolean NOT NULL DEFAULT false,
  reason text,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,instrument_version_id,location_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id)
);

CREATE TABLE IF NOT EXISTS simulation_protections (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, protection_order_id text NOT NULL,
  instrument_version_id text NOT NULL, location_id text NOT NULL,
  originating_order_id text NOT NULL, policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  intended_hash text NOT NULL CHECK (intended_hash ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz, confirmed_event_hash text, rejected_event_hash text,
  status text NOT NULL CHECK (status IN ('intended','requested','confirmed','rejected','uncertain')),
  reason text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,protection_order_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,instrument_version_id,location_id)
    REFERENCES simulation_positions(environment,scope_id,strategy_account_id,run_id,
      instrument_version_id,location_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,originating_order_id)
    REFERENCES simulation_orders(environment,scope_id,strategy_account_id,run_id,order_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,confirmed_event_hash)
    REFERENCES simulation_order_events(environment,scope_id,strategy_account_id,run_id,event_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,rejected_event_hash)
    REFERENCES simulation_order_events(environment,scope_id,strategy_account_id,run_id,event_hash),
  CHECK (confirmed_event_hash IS NULL OR rejected_event_hash IS NULL),
  CHECK ((status = 'confirmed') = (confirmed_event_hash IS NOT NULL)),
  CHECK ((status = 'rejected') = (rejected_event_hash IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS simulation_commands (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, command_id text NOT NULL, command_hash text NOT NULL
    CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  operation text NOT NULL CHECK (operation IN ('stop_entries','request_cancel','request_close')),
  target_id text, outcome text NOT NULL CHECK (outcome IN ('applied','rejected')),
  reason text, projection_revision bigint NOT NULL CHECK (projection_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id)
);

CREATE TABLE IF NOT EXISTS simulation_advance_claims (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, command_id text NOT NULL, manifest_hash text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id)
);

CREATE OR REPLACE FUNCTION simulation_reject_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulation fact is immutable'; END $$;
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['simulation_order_events','simulation_event_journal_links',
    'simulation_commands','simulation_advance_claims'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', item, item);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION simulation_reject_immutable()', item, item);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION simulation_guard_run_identity() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'simulation run identity is immutable'; END IF;
  IF (NEW.environment,NEW.scope_id,NEW.strategy_account_id,NEW.run_id,NEW.manifest_hash,
      NEW.registration_key,NEW.manifest_json,NEW.scenario_hash,NEW.created_by_subject,
      NEW.experiment_request_hash,NEW.authority_fingerprint,NEW.authority_epoch)
     IS DISTINCT FROM
     (OLD.environment,OLD.scope_id,OLD.strategy_account_id,OLD.run_id,OLD.manifest_hash,
      OLD.registration_key,OLD.manifest_json,OLD.scenario_hash,OLD.created_by_subject,
      OLD.experiment_request_hash,OLD.authority_fingerprint,OLD.authority_epoch) THEN
    RAISE EXCEPTION 'simulation run identity is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_runs_identity ON simulation_runs;
CREATE TRIGGER simulation_runs_identity BEFORE UPDATE OR DELETE ON simulation_runs
  FOR EACH ROW EXECUTE FUNCTION simulation_guard_run_identity();
CREATE OR REPLACE FUNCTION simulation_guard_order_identity() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'simulation order identity is immutable'; END IF;
  IF (NEW.environment,NEW.scope_id,NEW.strategy_account_id,NEW.run_id,NEW.order_id,
      NEW.order_ordinal,NEW.intent_id,NEW.intent_hash,NEW.permit_hash,NEW.permit_json,
      NEW.client_id,NEW.attempt_id,NEW.reservation_id,NEW.normalized_payload_hash,
      NEW.instrument_version_id,NEW.action,NEW.side,NEW.quantity_kind,NEW.quantity_units)
     IS DISTINCT FROM
     (OLD.environment,OLD.scope_id,OLD.strategy_account_id,OLD.run_id,OLD.order_id,
      OLD.order_ordinal,OLD.intent_id,OLD.intent_hash,OLD.permit_hash,OLD.permit_json,
      OLD.client_id,OLD.attempt_id,OLD.reservation_id,OLD.normalized_payload_hash,
      OLD.instrument_version_id,OLD.action,OLD.side,OLD.quantity_kind,OLD.quantity_units) THEN
    RAISE EXCEPTION 'simulation order identity is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_orders_identity ON simulation_orders;
CREATE TRIGGER simulation_orders_identity BEFORE UPDATE OR DELETE ON simulation_orders
  FOR EACH ROW EXECUTE FUNCTION simulation_guard_order_identity();
CREATE OR REPLACE FUNCTION simulation_guard_protection_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$ DECLARE fact record; BEGIN
  IF NEW.confirmed_event_hash IS NOT NULL THEN
    SELECT kind,event_json INTO fact FROM simulation_order_events
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
      AND event_hash=NEW.confirmed_event_hash;
    IF fact.kind IS DISTINCT FROM 'protection_accepted' OR
       fact.event_json->>'protection_order_id' IS DISTINCT FROM NEW.protection_order_id THEN
      RAISE EXCEPTION 'confirmed protection lacks matching accepted fact';
    END IF;
  END IF;
  IF NEW.rejected_event_hash IS NOT NULL THEN
    SELECT kind,event_json INTO fact FROM simulation_order_events
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
      AND event_hash=NEW.rejected_event_hash;
    IF fact.kind IS DISTINCT FROM 'protection_rejected' OR
       fact.event_json->>'protection_order_id' IS DISTINCT FROM NEW.protection_order_id THEN
      RAISE EXCEPTION 'rejected protection lacks matching rejection fact';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_protections_evidence ON simulation_protections;
CREATE TRIGGER simulation_protections_evidence BEFORE INSERT OR UPDATE ON simulation_protections
  FOR EACH ROW EXECUTE FUNCTION simulation_guard_protection_evidence();
COMMIT;
