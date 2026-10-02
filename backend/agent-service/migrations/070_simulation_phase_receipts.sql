BEGIN;

-- Original responses, including no-ops, belong to an exact activity substep.
-- Run revision changes are never evidence that a different command completed.
CREATE TABLE IF NOT EXISTS simulation_phase_receipts (
  environment text NOT NULL CHECK (environment='experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  phase text NOT NULL CHECK (phase IN
    ('controls','fold','checkpoint','entry','cursor','settlement','protection')),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  inputs_json jsonb NOT NULL CHECK (jsonb_typeof(inputs_json)='object'),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,command_id,phase),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  CHECK (octet_length(inputs_json::text) <= 8192),
  CHECK (octet_length(result_json::text) <= 131072)
);

CREATE OR REPLACE FUNCTION simulation_guard_phase_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$ DECLARE expected_manifest text; BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'simulation phase receipt is immutable';
  END IF;
  SELECT manifest_hash INTO expected_manifest FROM simulation_runs
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id;
  IF expected_manifest IS NULL OR expected_manifest<>NEW.manifest_hash THEN
    RAISE EXCEPTION 'simulation phase receipt differs from its run';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_phase_receipts_guard ON simulation_phase_receipts;
CREATE TRIGGER simulation_phase_receipts_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_phase_receipts FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_phase_receipt();

ALTER TABLE simulation_phase_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants ON simulation_phase_receipts;
CREATE POLICY simulation_preserve_existing_grants ON simulation_phase_receipts
  AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS simulation_experiment_only ON simulation_phase_receipts;
CREATE POLICY simulation_experiment_only ON simulation_phase_receipts
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING (environment='experiment') WITH CHECK (environment='experiment');
REVOKE ALL ON simulation_phase_receipts FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_phase_receipts TO moeazi_simulation_writer;

COMMIT;
