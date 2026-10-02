BEGIN;

CREATE TABLE IF NOT EXISTS simulation_flat_resolutions (
  environment text NOT NULL, scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, instrument_version_id text NOT NULL, command_id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  resolution_hash text NOT NULL CHECK (resolution_hash ~ '^[a-f0-9]{64}$'),
  account_revision bigint NOT NULL CHECK (account_revision>=0),
  account_snapshot_hash text NOT NULL CHECK (account_snapshot_hash ~ '^[a-f0-9]{64}$'),
  replay_cursor_at timestamptz NOT NULL,
  source_root text NOT NULL CHECK (source_root ~ '^[a-f0-9]{64}$'),
  journal_root text NOT NULL CHECK (journal_root ~ '^[a-f0-9]{64}$'),
  position_root text NOT NULL CHECK (position_root ~ '^[a-f0-9]{64}$'),
  proof_json jsonb NOT NULL CHECK (jsonb_typeof(proof_json)='object'
    AND octet_length(proof_json::text)<=65536),
  PRIMARY KEY(environment,scope_id,strategy_account_id,run_id,resolution_hash),
  UNIQUE(environment,scope_id,strategy_account_id,run_id,command_id),
  UNIQUE(environment,scope_id,strategy_account_id,run_id,instrument_version_id,
    account_revision),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id)
);
ALTER TABLE simulation_protections ADD COLUMN IF NOT EXISTS resolution_hash text;
ALTER TABLE simulation_protections DROP CONSTRAINT IF EXISTS simulation_protection_flat_resolution;
ALTER TABLE simulation_protections ADD CONSTRAINT simulation_protection_flat_resolution
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id,resolution_hash)
  REFERENCES simulation_flat_resolutions(environment,scope_id,strategy_account_id,run_id,resolution_hash);

CREATE OR REPLACE FUNCTION simulation_guard_flat_resolution() RETURNS trigger
LANGUAGE plpgsql AS $$ DECLARE positions jsonb; obligations jsonb; settlements jsonb; BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'flat resolutions are immutable'; END IF;
  -- Serialize proof creation with finance writes even for a direct SQL caller.
  PERFORM 1 FROM finance_accounts WHERE environment=NEW.environment
    AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id FOR UPDATE;
  IF NEW.proof_json->'scope' IS DISTINCT FROM jsonb_build_object(
      'environment',NEW.environment,'scope_id',NEW.scope_id,'strategy_account_id',NEW.strategy_account_id)
    OR NEW.proof_json->>'runId' IS DISTINCT FROM NEW.run_id
    OR NEW.proof_json->>'instrumentVersionId' IS DISTINCT FROM NEW.instrument_version_id
    OR NEW.proof_json->>'commandId' IS DISTINCT FROM NEW.command_id
    OR NEW.proof_json->>'manifestHash' IS DISTINCT FROM NEW.manifest_hash
    OR NEW.proof_json->>'resolutionHash' IS DISTINCT FROM NEW.resolution_hash
    OR (NEW.proof_json->>'accountRevision')::bigint IS DISTINCT FROM NEW.account_revision
    OR NEW.proof_json->>'accountSnapshotHash' IS DISTINCT FROM NEW.account_snapshot_hash
    OR (NEW.proof_json->>'replayCursorAt')::timestamptz IS DISTINCT FROM NEW.replay_cursor_at
    OR NEW.proof_json->>'sourceRoot' IS DISTINCT FROM NEW.source_root
    OR NEW.proof_json->>'journalRoot' IS DISTINCT FROM NEW.journal_root
    OR NEW.proof_json->>'positionRoot' IS DISTINCT FROM NEW.position_root THEN
    RAISE EXCEPTION 'flat resolution body differs from identity';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM simulation_runs r JOIN finance_accounts a
      USING(environment,scope_id,strategy_account_id)
    JOIN finance_reconciliation_checkpoints c ON c.environment=a.environment
      AND c.scope_id=a.scope_id AND c.strategy_account_id=a.strategy_account_id
      AND c.account_revision=a.revision
    JOIN simulation_derived_snapshots d ON d.environment=r.environment AND d.scope_id=r.scope_id
      AND d.strategy_account_id=r.strategy_account_id AND d.run_id=r.run_id
      AND d.snapshot_hash=a.observation_snapshot_hash
    WHERE r.environment=NEW.environment AND r.scope_id=NEW.scope_id
      AND r.strategy_account_id=NEW.strategy_account_id AND r.run_id=NEW.run_id
      AND r.manifest_hash=NEW.manifest_hash AND r.replay_cursor_at=NEW.replay_cursor_at
      AND a.revision=NEW.account_revision AND a.reconciliation_state='clean'
      AND a.observation_snapshot_hash=NEW.account_snapshot_hash
      AND c.result='clean' AND c.reason=a.reconciliation_reason
      AND c.observation_snapshot_hash=NEW.account_snapshot_hash AND c.journal_root_hash=NEW.journal_root
      AND d.manifest_hash=NEW.manifest_hash AND d.replay_cursor_at=NEW.replay_cursor_at
      AND d.source_root=NEW.source_root AND d.journal_root=NEW.journal_root AND d.position_root=NEW.position_root
  ) THEN RAISE EXCEPTION 'flat resolution lacks current clean source checkpoint'; END IF;
  IF EXISTS (SELECT 1 FROM finance_pending_events WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id) OR
    EXISTS (SELECT 1 FROM simulation_positions p WHERE p.environment=NEW.environment
      AND p.scope_id=NEW.scope_id AND p.strategy_account_id=NEW.strategy_account_id
      AND p.instrument_version_id=NEW.instrument_version_id
      AND (p.run_id<>NEW.run_id OR p.signed_exposure_units<>0 OR
        p.collateral_units<>0 OR p.reconciliation_state<>'clean'
        OR p.arithmetic_state_hash IS NULL OR p.arithmetic_state_json IS NULL
        OR (p.arithmetic_state_json->>'signed_quantity_units') IS DISTINCT FROM '0'
        OR (p.arithmetic_state_json->>'collateral_units') IS DISTINCT FROM '0'
        OR (p.arithmetic_state_json->>'margin_reserved_units') IS DISTINCT FROM '0')) OR
    EXISTS (SELECT 1 FROM simulation_intents i JOIN finance_reservations h
      USING(environment,scope_id,strategy_account_id,intent_id)
      WHERE i.environment=NEW.environment AND i.scope_id=NEW.scope_id
        AND i.strategy_account_id=NEW.strategy_account_id
        AND i.intent_json->>'instrument_version_id'=NEW.instrument_version_id
        AND h.status NOT IN ('settled','released')) OR
    EXISTS (SELECT 1 FROM simulation_orders o LEFT JOIN simulation_reservation_resolutions z
      USING(environment,scope_id,strategy_account_id,run_id,order_id)
      WHERE o.environment=NEW.environment AND o.scope_id=NEW.scope_id
        AND o.strategy_account_id=NEW.strategy_account_id
        AND o.instrument_version_id=NEW.instrument_version_id AND
        (o.run_id<>NEW.run_id OR o.status NOT IN ('filled','cancelled','rejected')
          OR z.resolution_hash IS NULL
          OR z.terminal_event_hash IS DISTINCT FROM o.terminal_event_hash
          OR z.terminal_order_status IS DISTINCT FROM o.status
          OR z.permit_hash IS DISTINCT FROM o.permit_hash
          OR z.reservation_id IS DISTINCT FROM o.reservation_id
          OR z.cumulative_filled_units IS DISTINCT FROM o.cumulative_filled_units)) THEN
    RAISE EXCEPTION 'flat resolution retains exposure or unsettled source obligations';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('locationId',location_id,'positionRevision',revision,
      'positionStateHash',arithmetic_state_hash) ORDER BY location_id) INTO positions
    FROM simulation_positions WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
      AND instrument_version_id=NEW.instrument_version_id;
  SELECT coalesce(jsonb_agg(intended_hash ORDER BY intended_hash),'[]'::jsonb) INTO obligations
    FROM simulation_protections WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
      AND instrument_version_id=NEW.instrument_version_id AND resolution_hash IS NULL;
  SELECT jsonb_agg(z.resolution_hash ORDER BY z.resolution_hash) INTO settlements
    FROM simulation_orders o JOIN simulation_reservation_resolutions z
      USING(environment,scope_id,strategy_account_id,run_id,order_id)
    WHERE o.environment=NEW.environment AND o.scope_id=NEW.scope_id
      AND o.strategy_account_id=NEW.strategy_account_id AND o.run_id=NEW.run_id
      AND o.instrument_version_id=NEW.instrument_version_id;
  IF positions IS NULL OR settlements IS NULL OR
      NEW.proof_json->'positions' IS DISTINCT FROM positions OR
      NEW.proof_json->'obligationIntendedHashes' IS DISTINCT FROM obligations OR
      NEW.proof_json->'reservationResolutionHashes' IS DISTINCT FROM settlements THEN
    RAISE EXCEPTION 'flat resolution omits exact position or terminal proof inventory';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_flat_resolutions_guard ON simulation_flat_resolutions;
CREATE TRIGGER simulation_flat_resolutions_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_flat_resolutions FOR EACH ROW EXECUTE FUNCTION simulation_guard_flat_resolution();

CREATE OR REPLACE FUNCTION simulation_guard_protection_resolution() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.resolution_hash IS NOT NULL THEN
    PERFORM 1 FROM finance_accounts WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id FOR UPDATE;
  END IF;
  IF TG_OP='UPDATE' AND OLD.resolution_hash IS NOT NULL THEN
    IF ROW(NEW.resolution_hash,NEW.status,NEW.requested_at,NEW.confirmed_event_hash,
        NEW.rejected_event_hash) IS DISTINCT FROM
       ROW(OLD.resolution_hash,OLD.status,OLD.requested_at,OLD.confirmed_event_hash,
        OLD.rejected_event_hash) THEN
      RAISE EXCEPTION 'resolved protection outcome cannot change';
    END IF;
    -- Historical proof stays valid after later positions/account revisions.
    RETURN NEW;
  END IF;
  IF NEW.resolution_hash IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM simulation_flat_resolutions f
    JOIN finance_accounts a USING(environment,scope_id,strategy_account_id)
    JOIN simulation_runs r USING(environment,scope_id,strategy_account_id,run_id)
    WHERE f.environment=NEW.environment AND f.scope_id=NEW.scope_id
      AND f.strategy_account_id=NEW.strategy_account_id AND f.run_id=NEW.run_id
      AND f.resolution_hash=NEW.resolution_hash AND f.instrument_version_id=NEW.instrument_version_id
      AND f.proof_json->'obligationIntendedHashes' ? NEW.intended_hash
      AND f.account_revision=a.revision AND f.account_snapshot_hash=a.observation_snapshot_hash
      AND a.reconciliation_state='clean' AND f.replay_cursor_at=r.replay_cursor_at
      AND f.proof_json->'positions' IS NOT DISTINCT FROM (
        SELECT jsonb_agg(jsonb_build_object('locationId',p.location_id,
          'positionRevision',p.revision,'positionStateHash',p.arithmetic_state_hash)
          ORDER BY p.location_id) FROM simulation_positions p
        WHERE p.environment=NEW.environment AND p.scope_id=NEW.scope_id
          AND p.strategy_account_id=NEW.strategy_account_id AND p.run_id=NEW.run_id
          AND p.instrument_version_id=NEW.instrument_version_id)
      AND NOT EXISTS (SELECT 1 FROM simulation_positions p
        WHERE p.environment=NEW.environment AND p.scope_id=NEW.scope_id
          AND p.strategy_account_id=NEW.strategy_account_id
          AND p.instrument_version_id=NEW.instrument_version_id AND p.run_id<>NEW.run_id)
      AND NOT EXISTS (SELECT 1 FROM simulation_positions p
        WHERE p.environment=NEW.environment AND p.scope_id=NEW.scope_id
          AND p.strategy_account_id=NEW.strategy_account_id AND p.run_id=NEW.run_id
          AND p.instrument_version_id=NEW.instrument_version_id
          AND (p.signed_exposure_units<>0 OR p.collateral_units<>0 OR
            p.reconciliation_state<>'clean' OR p.arithmetic_state_json IS NULL OR
            (p.arithmetic_state_json->>'signed_quantity_units') IS DISTINCT FROM '0' OR
            (p.arithmetic_state_json->>'collateral_units') IS DISTINCT FROM '0' OR
            (p.arithmetic_state_json->>'margin_reserved_units') IS DISTINCT FROM '0'))
      AND NOT EXISTS (SELECT 1 FROM simulation_intents i JOIN finance_reservations h
        USING(environment,scope_id,strategy_account_id,intent_id)
        WHERE i.environment=NEW.environment AND i.scope_id=NEW.scope_id
          AND i.strategy_account_id=NEW.strategy_account_id
          AND i.intent_json->>'instrument_version_id'=NEW.instrument_version_id
          AND h.status NOT IN ('settled','released'))
  ) THEN RAISE EXCEPTION 'protection resolution lacks its exact flat proof'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_protection_resolution_guard ON simulation_protections;
CREATE TRIGGER simulation_protection_resolution_guard BEFORE INSERT OR UPDATE
  ON simulation_protections FOR EACH ROW EXECUTE FUNCTION simulation_guard_protection_resolution();

CREATE OR REPLACE FUNCTION simulation_guard_position_completion() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.pending_obligations AND NOT NEW.pending_obligations THEN
    PERFORM 1 FROM finance_accounts WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id FOR UPDATE;
  END IF;
  IF OLD.pending_obligations AND NOT NEW.pending_obligations AND NOT EXISTS (
    SELECT 1 FROM simulation_flat_resolutions f JOIN finance_accounts a
      USING(environment,scope_id,strategy_account_id)
    JOIN simulation_runs r USING(environment,scope_id,strategy_account_id,run_id)
    WHERE f.environment=NEW.environment AND f.scope_id=NEW.scope_id
      AND f.strategy_account_id=NEW.strategy_account_id AND f.run_id=NEW.run_id
      AND f.instrument_version_id=NEW.instrument_version_id AND f.account_revision=a.revision
      AND f.account_snapshot_hash=a.observation_snapshot_hash AND a.reconciliation_state='clean'
      AND f.replay_cursor_at=r.replay_cursor_at AND NEW.signed_exposure_units=0
      AND NEW.collateral_units=0 AND NEW.reconciliation_state='clean'
      AND (NEW.arithmetic_state_json->>'signed_quantity_units')='0'
      AND (NEW.arithmetic_state_json->>'collateral_units')='0'
      AND (NEW.arithmetic_state_json->>'margin_reserved_units')='0'
      AND f.proof_json->'positions' @> jsonb_build_array(jsonb_build_object(
        'locationId',NEW.location_id,'positionRevision',NEW.revision,
        'positionStateHash',NEW.arithmetic_state_hash))
      AND NOT EXISTS (SELECT 1 FROM simulation_protections q
        WHERE q.environment=NEW.environment AND q.scope_id=NEW.scope_id
          AND q.strategy_account_id=NEW.strategy_account_id AND q.run_id=NEW.run_id
          AND q.instrument_version_id=NEW.instrument_version_id
          AND (q.resolution_hash IS NULL OR
            (f.proof_json->'obligationIntendedHashes' ? q.intended_hash AND
             q.resolution_hash IS DISTINCT FROM f.resolution_hash)))
  ) THEN RAISE EXCEPTION 'position completion lacks current flat source proof'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_position_completion_guard ON simulation_positions;
CREATE TRIGGER simulation_position_completion_guard BEFORE UPDATE ON simulation_positions
  FOR EACH ROW EXECUTE FUNCTION simulation_guard_position_completion();

ALTER TABLE simulation_flat_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants ON simulation_flat_resolutions;
CREATE POLICY simulation_preserve_existing_grants ON simulation_flat_resolutions
  AS PERMISSIVE FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS simulation_experiment_only ON simulation_flat_resolutions;
CREATE POLICY simulation_experiment_only ON simulation_flat_resolutions
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING(environment='experiment') WITH CHECK(environment='experiment');
REVOKE ALL ON simulation_flat_resolutions FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_flat_resolutions TO moeazi_simulation_writer;

ALTER TABLE simulation_phase_receipts DROP CONSTRAINT IF EXISTS simulation_phase_receipts_phase_check;
ALTER TABLE simulation_phase_receipts ADD CONSTRAINT simulation_phase_receipts_phase_check
  CHECK (phase IN ('controls','fold','checkpoint','entry','cursor','settlement','protection',
    'resolution','maintenance_select','maintenance'));
COMMIT;
