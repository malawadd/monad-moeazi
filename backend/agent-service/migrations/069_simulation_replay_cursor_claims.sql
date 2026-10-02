BEGIN;

-- Each worker command may advance at most one immutable replay cursor step.
-- The database clock still fences the writer; these timestamps belong only to
-- the frozen historical scenario and never renew financial evidence by age.
CREATE TABLE IF NOT EXISTS simulation_replay_cursor_claims (
  environment text NOT NULL CHECK (environment='experiment'),
  scope_id text NOT NULL,
  strategy_account_id text NOT NULL,
  run_id text NOT NULL,
  command_id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  previous_cursor_at timestamptz NOT NULL,
  next_cursor_at timestamptz NOT NULL,
  source_root text NOT NULL CHECK (source_root ~ '^[a-f0-9]{64}$'),
  account_snapshot_hash text NOT NULL CHECK (account_snapshot_hash ~ '^[a-f0-9]{64}$'),
  projection_revision bigint NOT NULL CHECK (projection_revision >= 0),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  CHECK (next_cursor_at >= previous_cursor_at)
);

CREATE OR REPLACE FUNCTION simulation_guard_replay_cursor_claim() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE registered_hash text;
DECLARE registered_cursor timestamptz;
DECLARE registered_scenario jsonb;
DECLARE account_snapshot text;
DECLARE scenario_start timestamptz;
DECLARE scenario_end timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'replay cursor command history is immutable';
  END IF;
  SELECT manifest_hash,replay_cursor_at,manifest_json->'scenario'
    INTO registered_hash,registered_cursor,registered_scenario
    FROM simulation_runs WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
      AND run_id=NEW.run_id;
  SELECT observation_snapshot_hash INTO account_snapshot FROM finance_accounts
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id;
  IF registered_scenario IS NOT NULL THEN
    scenario_start := (registered_scenario->>'simulation_cursor_at')::timestamptz;
    scenario_end := (registered_scenario->>'simulation_end_at')::timestamptz;
  END IF;
  IF registered_hash IS NULL OR registered_cursor IS NULL OR
      registered_hash <> NEW.manifest_hash OR
      registered_cursor <> NEW.previous_cursor_at OR
      account_snapshot IS NULL OR
      account_snapshot <> NEW.account_snapshot_hash OR
      scenario_start IS NULL OR scenario_end IS NULL OR
      NEW.previous_cursor_at < scenario_start OR
      NEW.next_cursor_at > scenario_end THEN
    RAISE EXCEPTION 'replay cursor claim does not bind current immutable run';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_replay_cursor_claims_guard
  ON simulation_replay_cursor_claims;
CREATE TRIGGER simulation_replay_cursor_claims_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_replay_cursor_claims FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_replay_cursor_claim();

ALTER TABLE simulation_replay_cursor_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants
  ON simulation_replay_cursor_claims;
CREATE POLICY simulation_preserve_existing_grants
  ON simulation_replay_cursor_claims AS PERMISSIVE FOR ALL TO PUBLIC
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS simulation_experiment_only
  ON simulation_replay_cursor_claims;
CREATE POLICY simulation_experiment_only ON simulation_replay_cursor_claims
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING (environment='experiment') WITH CHECK (environment='experiment');
REVOKE ALL ON simulation_replay_cursor_claims FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_replay_cursor_claims TO moeazi_simulation_writer;

COMMIT;
