BEGIN;

-- A user-authenticated close command narrows an existing simulated position.
-- This receipt never grants a new entry or certifies venue protection.
ALTER TABLE simulation_commands ADD COLUMN IF NOT EXISTS requested_by_subject text;
ALTER TABLE simulation_commands DROP CONSTRAINT IF EXISTS simulation_control_actor_length;
ALTER TABLE simulation_commands ADD CONSTRAINT simulation_control_actor_length
  CHECK (requested_by_subject IS NULL OR length(requested_by_subject) BETWEEN 1 AND 512);

CREATE TABLE IF NOT EXISTS simulation_maintenance_reductions (
  environment text NOT NULL CHECK (environment='experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  command_id text NOT NULL, command_hash text NOT NULL CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  maintenance_order_id text NOT NULL,
  instrument_version_id text NOT NULL, location_id text NOT NULL,
  anchor_protection_order_id text NOT NULL,
  account_snapshot_hash text NOT NULL CHECK (account_snapshot_hash ~ '^[a-f0-9]{64}$'),
  account_revision bigint NOT NULL CHECK (account_revision>=0),
  position_state_hash text NOT NULL CHECK (position_state_hash ~ '^[a-f0-9]{64}$'),
  position_revision bigint NOT NULL CHECK (position_revision>0),
  signed_exposure_units finance_native_units NOT NULL CHECK (signed_exposure_units<>0),
  reduction_action text NOT NULL CHECK (reduction_action IN ('spot_sell','perp_reduce','perp_close')),
  side text NOT NULL CHECK (side IN ('buy','sell')),
  quantity_units finance_native_units NOT NULL CHECK (quantity_units>0),
  decision_hash text NOT NULL CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  sizing_receipt_hash text NOT NULL CHECK (sizing_receipt_hash ~ '^[a-f0-9]{64}$'),
  reservation_id text NOT NULL, intent_id text NOT NULL,
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  execution_envelope_hash text NOT NULL CHECK (execution_envelope_hash ~ '^[a-f0-9]{64}$'),
  receipt_json jsonb NOT NULL CHECK (jsonb_typeof(receipt_json)='object'
    AND octet_length(receipt_json::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,scope_id,strategy_account_id,run_id,receipt_hash),
  UNIQUE(environment,scope_id,strategy_account_id,run_id,command_id),
  UNIQUE(environment,scope_id,strategy_account_id,run_id,maintenance_order_id),
  UNIQUE(environment,scope_id,strategy_account_id,run_id,reservation_id),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id,command_id)
    REFERENCES simulation_commands(environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id,instrument_version_id,location_id)
    REFERENCES simulation_positions(environment,scope_id,strategy_account_id,run_id,
      instrument_version_id,location_id),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id,intent_id,intent_hash)
    REFERENCES simulation_intents(environment,scope_id,strategy_account_id,run_id,
      intent_id,intent_hash),
  FOREIGN KEY(environment,scope_id,strategy_account_id,reservation_id)
    REFERENCES finance_reservations(environment,scope_id,strategy_account_id,reservation_id),
  FOREIGN KEY(environment,scope_id,strategy_account_id,sizing_receipt_hash)
    REFERENCES finance_calculation_receipts(environment,scope_id,strategy_account_id,receipt_hash),
  CHECK (quantity_units<=abs(signed_exposure_units)),
  CHECK (maintenance_order_id<>anchor_protection_order_id),
  CHECK ((signed_exposure_units>0 AND side='sell') OR
         (signed_exposure_units<0 AND side='buy' AND reduction_action<>'spot_sell')),
  CHECK (receipt_json->'scope' IS NOT DISTINCT FROM jsonb_build_object(
    'environment',environment,'scope_id',scope_id,'strategy_account_id',strategy_account_id)),
  CHECK (receipt_json->>'receipt_hash' IS NOT DISTINCT FROM receipt_hash),
  CHECK (receipt_json->>'run_id' IS NOT DISTINCT FROM run_id),
  CHECK (receipt_json->>'manifest_hash' IS NOT DISTINCT FROM manifest_hash),
  CHECK (receipt_json->>'command_id' IS NOT DISTINCT FROM command_id),
  CHECK (receipt_json->>'command_hash' IS NOT DISTINCT FROM command_hash),
  CHECK (receipt_json->>'maintenance_order_id' IS NOT DISTINCT FROM maintenance_order_id),
  CHECK (receipt_json->>'instrument_version_id' IS NOT DISTINCT FROM instrument_version_id),
  CHECK (receipt_json->>'location_id' IS NOT DISTINCT FROM location_id),
  CHECK (receipt_json->>'anchor_protection_order_id'
    IS NOT DISTINCT FROM anchor_protection_order_id),
  CHECK (receipt_json->>'account_snapshot_hash' IS NOT DISTINCT FROM account_snapshot_hash),
  CHECK ((receipt_json->>'account_revision')::bigint IS NOT DISTINCT FROM account_revision),
  CHECK (receipt_json->>'position_state_hash' IS NOT DISTINCT FROM position_state_hash),
  CHECK ((receipt_json->>'position_revision')::bigint IS NOT DISTINCT FROM position_revision),
  CHECK ((receipt_json->>'signed_exposure_units')::numeric IS NOT DISTINCT FROM signed_exposure_units),
  CHECK (receipt_json->>'reduction_action' IS NOT DISTINCT FROM reduction_action),
  CHECK (receipt_json->>'side' IS NOT DISTINCT FROM side),
  CHECK ((receipt_json->>'quantity_units')::numeric IS NOT DISTINCT FROM quantity_units),
  CHECK (receipt_json->>'decision_hash' IS NOT DISTINCT FROM decision_hash),
  CHECK (receipt_json->>'sizing_receipt_hash' IS NOT DISTINCT FROM sizing_receipt_hash),
  CHECK (receipt_json->>'reservation_id' IS NOT DISTINCT FROM reservation_id),
  CHECK (receipt_json->>'intent_id' IS NOT DISTINCT FROM intent_id),
  CHECK (receipt_json->>'intent_hash' IS NOT DISTINCT FROM intent_hash),
  CHECK (receipt_json->>'execution_envelope_hash'
    IS NOT DISTINCT FROM execution_envelope_hash)
);

CREATE TABLE IF NOT EXISTS simulation_maintenance_obligation_links (
  environment text NOT NULL CHECK (environment='experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL, run_id text NOT NULL,
  receipt_hash text NOT NULL, protection_order_id text NOT NULL,
  intended_hash text NOT NULL CHECK (intended_hash ~ '^[a-f0-9]{64}$'),
  originating_event_hash text NOT NULL CHECK (originating_event_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(environment,scope_id,strategy_account_id,run_id,receipt_hash,protection_order_id),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id,receipt_hash)
    REFERENCES simulation_maintenance_reductions(environment,scope_id,strategy_account_id,
      run_id,receipt_hash),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id,protection_order_id)
    REFERENCES simulation_protections(environment,scope_id,strategy_account_id,run_id,
      protection_order_id)
);

CREATE OR REPLACE FUNCTION simulation_guard_maintenance_reduction()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual jsonb; linked jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'maintenance reductions are immutable'; END IF;
  PERFORM 1 FROM finance_accounts WHERE environment=NEW.environment
    AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM simulation_runs r JOIN finance_accounts a
      USING(environment,scope_id,strategy_account_id)
      JOIN simulation_commands c ON c.environment=r.environment AND c.scope_id=r.scope_id
        AND c.strategy_account_id=r.strategy_account_id AND c.run_id=r.run_id
        AND c.command_id=NEW.command_id
      JOIN simulation_positions p ON p.environment=r.environment AND p.scope_id=r.scope_id
        AND p.strategy_account_id=r.strategy_account_id AND p.run_id=r.run_id
        AND p.instrument_version_id=NEW.instrument_version_id AND p.location_id=NEW.location_id
      JOIN finance_reservations h ON h.environment=a.environment AND h.scope_id=a.scope_id
        AND h.strategy_account_id=a.strategy_account_id AND h.reservation_id=NEW.reservation_id
      JOIN finance_calculation_receipts q ON q.environment=a.environment
        AND q.scope_id=a.scope_id AND q.strategy_account_id=a.strategy_account_id
        AND q.receipt_hash=NEW.sizing_receipt_hash
      JOIN simulation_intents i ON i.environment=r.environment AND i.scope_id=r.scope_id
        AND i.strategy_account_id=r.strategy_account_id AND i.run_id=r.run_id
        AND i.intent_id=NEW.intent_id
      WHERE r.environment=NEW.environment AND r.scope_id=NEW.scope_id
        AND r.strategy_account_id=NEW.strategy_account_id AND r.run_id=NEW.run_id
        AND r.manifest_hash=NEW.manifest_hash
        AND r.manifest_json->'controller_ref'=NEW.receipt_json->'controller_ref'
        AND c.command_hash=NEW.command_hash AND c.operation='request_close'
        AND c.target_id=NEW.instrument_version_id AND c.outcome='applied'
        AND c.requested_by_subject=r.created_by_subject
        AND a.revision=NEW.account_revision AND a.observation_snapshot_hash=NEW.account_snapshot_hash
        AND a.reconciliation_state='clean'
        AND p.reconciliation_state='clean' AND p.revision=NEW.position_revision
        AND p.arithmetic_state_hash=NEW.position_state_hash
        AND p.signed_exposure_units=NEW.signed_exposure_units
        AND h.status='reserved' AND h.purpose='trade'
        AND h.intent_id=NEW.intent_id
        AND h.admitted_revision=NEW.account_revision
        AND h.controller_ref=r.manifest_json->'controller_ref'
        AND h.controller_mode=r.manifest_json->>'controller_mode'
        AND h.calculation_receipt_hash=NEW.sizing_receipt_hash
        AND h.snapshot_hash=NEW.account_snapshot_hash
        AND h.policy_version=r.manifest_json->>'policy_version'
        AND h.policy_hash=r.manifest_json->>'policy_hash'
        AND q.account_revision=NEW.account_revision-1
        AND q.observation_snapshot_hash=NEW.account_snapshot_hash
        AND q.policy_version=r.manifest_json->>'policy_version'
        AND q.policy_hash=r.manifest_json->>'policy_hash'
        AND q.authority_class='experiment_only'
        AND q.receipt_json->>'code_version'='replay-sizing-v2'
        AND q.receipt_json->'execution_envelope'->>'envelope_hash'=
          NEW.execution_envelope_hash
        AND q.receipt_json->>'manifest_hash'=NEW.manifest_hash
        AND q.receipt_json->>'decision_hash'=NEW.decision_hash
        AND q.receipt_json->>'run_id'=NEW.run_id
        AND q.receipt_json->>'instrument_version_id'=NEW.instrument_version_id
        AND q.receipt_json->>'action'=NEW.reduction_action
        AND q.receipt_json->>'side'=NEW.side
        AND q.receipt_json->>'location_id'=NEW.location_id
        AND (q.receipt_json->>'quantity_units')::numeric=NEW.quantity_units
        AND q.receipt_json->>'position_state_hash'=NEW.position_state_hash
        AND (q.receipt_json->>'position_revision')::bigint=NEW.position_revision
        AND q.receipt_json->'execution_envelope'->>'position_state_hash'=
          NEW.position_state_hash
        AND (q.receipt_json->'execution_envelope'->>'position_revision')::bigint=
          NEW.position_revision
        AND i.intent_hash=NEW.intent_hash AND i.intent_json->>'action'=NEW.reduction_action
        AND i.intent_json->>'side'=NEW.side
        AND i.intent_json->'controller_ref'=r.manifest_json->'controller_ref'
        AND i.intent_json->>'run_manifest_hash'=NEW.manifest_hash
        AND i.intent_json->>'desired_quantity_units'=
          q.receipt_json->>'desired_quantity_units'
        AND i.intent_json->>'decision_context_hash'=NEW.decision_hash
        AND i.intent_json->>'calculation_receipt_hash'=NEW.sizing_receipt_hash
  ) THEN RAISE EXCEPTION 'maintenance receipt lacks exact close, position or hold'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'protection_order_id',p.protection_order_id,'intended_hash',p.intended_hash,
    'originating_event_hash',p.originating_event_hash)
    ORDER BY p.protection_order_id),'[]'::jsonb) INTO actual
    FROM simulation_protections p WHERE p.environment=NEW.environment
      AND p.scope_id=NEW.scope_id AND p.strategy_account_id=NEW.strategy_account_id
      AND p.instrument_version_id=NEW.instrument_version_id AND p.resolution_hash IS NULL;
  IF actual='[]'::jsonb OR actual IS DISTINCT FROM NEW.receipt_json->'obligations' OR
      NEW.anchor_protection_order_id IS DISTINCT FROM
        NEW.receipt_json->'obligations'->0->>'protection_order_id' OR
      EXISTS (SELECT 1 FROM simulation_protections p WHERE p.environment=NEW.environment
        AND p.scope_id=NEW.scope_id AND p.strategy_account_id=NEW.strategy_account_id
        AND p.instrument_version_id=NEW.instrument_version_id AND p.resolution_hash IS NULL
        AND (p.run_id<>NEW.run_id OR p.location_id<>NEW.location_id OR
             p.status<>'intended' OR p.originating_event_hash IS NULL)) OR
      EXISTS (SELECT 1 FROM simulation_orders o WHERE o.environment=NEW.environment
        AND o.scope_id=NEW.scope_id AND o.strategy_account_id=NEW.strategy_account_id
        AND o.run_id=NEW.run_id AND o.order_id=NEW.maintenance_order_id) OR
      EXISTS (SELECT 1 FROM simulation_orders o
        JOIN simulation_protections p ON p.environment=o.environment
          AND p.scope_id=o.scope_id AND p.strategy_account_id=o.strategy_account_id
          AND p.run_id=o.run_id
        WHERE p.environment=NEW.environment AND p.scope_id=NEW.scope_id
          AND p.strategy_account_id=NEW.strategy_account_id
          AND p.instrument_version_id=NEW.instrument_version_id
          AND p.resolution_hash IS NULL AND
          (o.order_id=p.protection_order_id OR
           o.permit_json->>'protection_order_id'=p.protection_order_id)) THEN
    RAISE EXCEPTION 'maintenance obligations are incomplete or already attempted';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_maintenance_guard ON simulation_maintenance_reductions;
CREATE TRIGGER simulation_maintenance_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_maintenance_reductions FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_maintenance_reduction();

CREATE OR REPLACE FUNCTION simulation_check_maintenance_links()
RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE actual jsonb; BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'protection_order_id',protection_order_id,'intended_hash',intended_hash,
    'originating_event_hash',originating_event_hash)
    ORDER BY protection_order_id),'[]'::jsonb) INTO actual
    FROM simulation_maintenance_obligation_links WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
      AND run_id=NEW.run_id AND receipt_hash=NEW.receipt_hash;
  IF actual IS DISTINCT FROM NEW.receipt_json->'obligations' THEN
    RAISE EXCEPTION 'maintenance obligation links differ from immutable receipt';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_maintenance_links_complete
  ON simulation_maintenance_reductions;
CREATE CONSTRAINT TRIGGER simulation_maintenance_links_complete AFTER INSERT
  ON simulation_maintenance_reductions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION simulation_check_maintenance_links();
DROP TRIGGER IF EXISTS simulation_maintenance_links_immutable
  ON simulation_maintenance_obligation_links;
CREATE TRIGGER simulation_maintenance_links_immutable BEFORE UPDATE OR DELETE
  ON simulation_maintenance_obligation_links FOR EACH ROW
  EXECUTE FUNCTION simulation_reject_immutable();
CREATE OR REPLACE FUNCTION simulation_guard_maintenance_link_insert()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM simulation_maintenance_reductions m
    JOIN simulation_protections p ON p.environment=m.environment
      AND p.scope_id=m.scope_id AND p.strategy_account_id=m.strategy_account_id
      AND p.run_id=m.run_id AND p.protection_order_id=NEW.protection_order_id
    WHERE m.environment=NEW.environment AND m.scope_id=NEW.scope_id
      AND m.strategy_account_id=NEW.strategy_account_id AND m.run_id=NEW.run_id
      AND m.receipt_hash=NEW.receipt_hash
      AND p.intended_hash=NEW.intended_hash
      AND p.originating_event_hash=NEW.originating_event_hash
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.receipt_json->'obligations') e
        WHERE e=jsonb_build_object('protection_order_id',NEW.protection_order_id,
          'intended_hash',NEW.intended_hash,
          'originating_event_hash',NEW.originating_event_hash))) THEN
    RAISE EXCEPTION 'maintenance link is absent from immutable source obligations';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_maintenance_link_insert
  ON simulation_maintenance_obligation_links;
CREATE TRIGGER simulation_maintenance_link_insert BEFORE INSERT
  ON simulation_maintenance_obligation_links FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_maintenance_link_insert();

ALTER TABLE simulation_maintenance_reductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_maintenance_obligation_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_maintenance_permissive ON simulation_maintenance_reductions;
CREATE POLICY simulation_maintenance_permissive ON simulation_maintenance_reductions
  AS PERMISSIVE FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS simulation_maintenance_experiment ON simulation_maintenance_reductions;
CREATE POLICY simulation_maintenance_experiment ON simulation_maintenance_reductions
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING(environment='experiment') WITH CHECK(environment='experiment');
DROP POLICY IF EXISTS simulation_maintenance_links_permissive ON simulation_maintenance_obligation_links;
CREATE POLICY simulation_maintenance_links_permissive ON simulation_maintenance_obligation_links
  AS PERMISSIVE FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS simulation_maintenance_links_experiment ON simulation_maintenance_obligation_links;
CREATE POLICY simulation_maintenance_links_experiment ON simulation_maintenance_obligation_links
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING(environment='experiment') WITH CHECK(environment='experiment');
REVOKE ALL ON simulation_maintenance_reductions,simulation_maintenance_obligation_links
  FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_maintenance_reductions,
  simulation_maintenance_obligation_links TO moeazi_simulation_writer;

COMMIT;
