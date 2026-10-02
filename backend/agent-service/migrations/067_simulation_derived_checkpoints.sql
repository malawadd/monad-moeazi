BEGIN;

-- A simulated account checkpoint has explicit provenance and is never a native
-- account observation. Existing recorded/native rows retain their old meaning.
ALTER TABLE observation_account_snapshots
  DROP CONSTRAINT IF EXISTS observation_account_snapshots_origin_check;
ALTER TABLE observation_account_snapshots
  ADD CONSTRAINT observation_account_snapshots_origin_check
  CHECK (origin IN ('native_verified','recorded_fixture','simulation_derived'));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='observation_simulation_derived_ceiling') THEN
    ALTER TABLE observation_account_snapshots ADD CONSTRAINT
      observation_simulation_derived_ceiling CHECK (
        origin <> 'simulation_derived' OR
        (environment='experiment' AND rights_ref='local_simulation_fixture_only'
         AND status='accepted' AND finality='admitted_final'
         AND finality_at IS NOT NULL AND balances_complete AND positions_complete
         AND NOT has_gap AND NOT has_reorg));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS simulation_derived_snapshots (
  environment text NOT NULL CHECK (environment='experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  baseline_snapshot_hash text NOT NULL CHECK (baseline_snapshot_hash ~ '^[a-f0-9]{64}$'),
  replay_cursor_at timestamptz NOT NULL,
  source_root text NOT NULL CHECK (source_root ~ '^[a-f0-9]{64}$'),
  journal_root text NOT NULL CHECK (journal_root ~ '^[a-f0-9]{64}$'),
  position_root text NOT NULL CHECK (position_root ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,snapshot_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  FOREIGN KEY (snapshot_hash)
    REFERENCES observation_account_snapshots(snapshot_hash),
  FOREIGN KEY (baseline_snapshot_hash)
    REFERENCES observation_account_snapshots(snapshot_hash)
);

CREATE OR REPLACE FUNCTION simulation_guard_derived_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE run_manifest text;
DECLARE run_cursor timestamptz;
DECLARE baseline_hash text;
DECLARE observation record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'simulated account checkpoint identity is immutable';
  END IF;
  SELECT manifest_hash,replay_cursor_at,
    manifest_json->>'account_snapshot_hash'
    INTO run_manifest,run_cursor,baseline_hash
    FROM simulation_runs WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
      AND run_id=NEW.run_id;
  SELECT environment,scope_id,strategy_account_id,origin,rights_ref,cutoff_at
    INTO observation FROM observation_account_snapshots
    WHERE snapshot_hash=NEW.snapshot_hash;
  IF run_manifest IS NULL OR run_cursor IS NULL OR observation.origin IS NULL OR
      NEW.manifest_hash <> run_manifest OR NEW.replay_cursor_at <> run_cursor OR
      NEW.baseline_snapshot_hash IS DISTINCT FROM baseline_hash OR
      (observation.environment,observation.scope_id,
       observation.strategy_account_id) IS DISTINCT FROM
      (NEW.environment,NEW.scope_id,NEW.strategy_account_id) OR
      observation.origin <> 'simulation_derived' OR
      observation.rights_ref <> 'local_simulation_fixture_only' OR
      observation.cutoff_at <> NEW.replay_cursor_at THEN
    RAISE EXCEPTION 'simulated checkpoint differs from run or account observation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_derived_snapshots_guard
  ON simulation_derived_snapshots;
CREATE TRIGGER simulation_derived_snapshots_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_derived_snapshots FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_derived_snapshot();

ALTER TABLE simulation_derived_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants
  ON simulation_derived_snapshots;
CREATE POLICY simulation_preserve_existing_grants ON simulation_derived_snapshots
  AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS simulation_experiment_only ON simulation_derived_snapshots;
CREATE POLICY simulation_experiment_only ON simulation_derived_snapshots
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING (environment='experiment') WITH CHECK (environment='experiment');
REVOKE ALL ON simulation_derived_snapshots FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_derived_snapshots TO moeazi_simulation_writer;

COMMIT;
