BEGIN;

CREATE TABLE IF NOT EXISTS simulation_entry_requests (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL, request_id text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  rule_hash text NOT NULL CHECK (rule_hash ~ '^[a-f0-9]{64}$'),
  rule_json jsonb NOT NULL, created_by_subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','evaluating','awaiting_finance',
    'awaiting_approval','submission_possible','awaiting_evidence','rejected','completed')),
  reason text, intent_id text, order_id text,
  request_sequence bigint NOT NULL CHECK (request_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,request_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,request_sequence),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id),
  CHECK ((rule_json->>'rule_hash') IS NOT DISTINCT FROM rule_hash)
);

CREATE OR REPLACE FUNCTION simulation_guard_entry_request() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'simulation entry request is durable'; END IF;
  IF (NEW.environment,NEW.scope_id,NEW.strategy_account_id,NEW.run_id,NEW.request_id,
      NEW.request_hash,NEW.manifest_hash,NEW.rule_hash,NEW.rule_json,
      NEW.created_by_subject,NEW.request_sequence)
     IS DISTINCT FROM
     (OLD.environment,OLD.scope_id,OLD.strategy_account_id,OLD.run_id,OLD.request_id,
      OLD.request_hash,OLD.manifest_hash,OLD.rule_hash,OLD.rule_json,
      OLD.created_by_subject,OLD.request_sequence) THEN
    RAISE EXCEPTION 'simulation entry request identity is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_entry_requests_identity ON simulation_entry_requests;
CREATE TRIGGER simulation_entry_requests_identity BEFORE UPDATE OR DELETE
  ON simulation_entry_requests FOR EACH ROW EXECUTE FUNCTION simulation_guard_entry_request();

ALTER TABLE simulation_entry_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_preserve_existing_grants ON simulation_entry_requests;
CREATE POLICY simulation_preserve_existing_grants ON simulation_entry_requests
  AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS simulation_experiment_only ON simulation_entry_requests;
CREATE POLICY simulation_experiment_only ON simulation_entry_requests
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING (environment = 'experiment') WITH CHECK (environment = 'experiment');
REVOKE ALL ON simulation_entry_requests FROM moeazi_simulation_writer;
GRANT SELECT,INSERT,UPDATE ON simulation_entry_requests TO moeazi_simulation_writer;

COMMIT;
