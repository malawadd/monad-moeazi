BEGIN;

-- Durable boundaries between research, finance and submission. A retry reuses
-- these exact inputs instead of recomputing a different economic operation.
CREATE TABLE IF NOT EXISTS simulation_entry_progress (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, request_id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  step text NOT NULL CHECK (step IN ('evaluation','admission','preparation','submission')),
  progress_hash text NOT NULL CHECK (progress_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,request_id,step),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,request_id)
    REFERENCES simulation_entry_requests
      (environment,scope_id,strategy_account_id,run_id,request_id)
);

CREATE OR REPLACE FUNCTION simulation_guard_entry_progress() RETURNS trigger
LANGUAGE plpgsql AS $$ DECLARE expected_manifest text; BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'simulation entry progress is immutable';
  END IF;
  SELECT manifest_hash INTO expected_manifest FROM simulation_entry_requests
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
      AND request_id=NEW.request_id;
  IF expected_manifest IS NULL OR NEW.manifest_hash <> expected_manifest THEN
    RAISE EXCEPTION 'simulation progress differs from immutable request';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_entry_progress_guard ON simulation_entry_progress;
CREATE TRIGGER simulation_entry_progress_guard BEFORE INSERT OR UPDATE OR DELETE
  ON simulation_entry_progress FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_entry_progress();

CREATE TABLE IF NOT EXISTS simulation_entry_dispatch_claims (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, command_id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  request_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,command_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,request_id)
    REFERENCES simulation_entry_requests
      (environment,scope_id,strategy_account_id,run_id,request_id)
);
DROP TRIGGER IF EXISTS simulation_entry_dispatch_claims_immutable
  ON simulation_entry_dispatch_claims;
CREATE TRIGGER simulation_entry_dispatch_claims_immutable BEFORE UPDATE OR DELETE
  ON simulation_entry_dispatch_claims FOR EACH ROW
  EXECUTE FUNCTION simulation_reject_immutable();
CREATE OR REPLACE FUNCTION simulation_guard_entry_dispatch() RETURNS trigger
LANGUAGE plpgsql AS $$ DECLARE expected_manifest text; BEGIN
  SELECT manifest_hash INTO expected_manifest FROM simulation_runs
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id;
  IF expected_manifest IS NULL OR NEW.manifest_hash <> expected_manifest THEN
    RAISE EXCEPTION 'simulation dispatch claim differs from immutable run';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_entry_dispatch_claims_guard ON simulation_entry_dispatch_claims;
CREATE TRIGGER simulation_entry_dispatch_claims_guard BEFORE INSERT
  ON simulation_entry_dispatch_claims FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_entry_dispatch();

ALTER TABLE simulation_entry_dispatch_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants ON simulation_entry_dispatch_claims;
CREATE POLICY simulation_preserve_existing_grants ON simulation_entry_dispatch_claims
  AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS simulation_experiment_only ON simulation_entry_dispatch_claims;
CREATE POLICY simulation_experiment_only ON simulation_entry_dispatch_claims
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING (environment = 'experiment') WITH CHECK (environment = 'experiment');
REVOKE ALL ON simulation_entry_dispatch_claims FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_entry_dispatch_claims TO moeazi_simulation_writer;

ALTER TABLE simulation_entry_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants ON simulation_entry_progress;
CREATE POLICY simulation_preserve_existing_grants ON simulation_entry_progress
  AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS simulation_experiment_only ON simulation_entry_progress;
CREATE POLICY simulation_experiment_only ON simulation_entry_progress
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING (environment = 'experiment') WITH CHECK (environment = 'experiment');
REVOKE ALL ON simulation_entry_progress FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_entry_progress TO moeazi_simulation_writer;

COMMIT;
