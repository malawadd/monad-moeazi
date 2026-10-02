BEGIN;

-- A run's ordered source corpus is separate from its pre-dispatch decision
-- EvidenceSnapshot. Later books retain their actual availability timestamps.
CREATE TABLE IF NOT EXISTS simulation_run_datasets (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL,
  strategy_account_id text NOT NULL,
  run_id text NOT NULL,
  dataset_hash text NOT NULL CHECK (dataset_hash ~ '^[a-f0-9]{64}$'),
  observation_count integer NOT NULL CHECK (observation_count BETWEEN 1 AND 4096),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,dataset_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id)
);

CREATE TABLE IF NOT EXISTS simulation_run_dataset_items (
  environment text NOT NULL CHECK (environment = 'experiment'),
  scope_id text NOT NULL,
  strategy_account_id text NOT NULL,
  run_id text NOT NULL,
  dataset_hash text NOT NULL CHECK (dataset_hash ~ '^[a-f0-9]{64}$'),
  observation_ordinal integer NOT NULL CHECK (observation_ordinal BETWEEN 0 AND 4095),
  observation_hash text NOT NULL CHECK (observation_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (environment,scope_id,strategy_account_id,run_id,observation_ordinal),
  UNIQUE (environment,scope_id,strategy_account_id,run_id,observation_hash),
  FOREIGN KEY (environment,scope_id,strategy_account_id,run_id,dataset_hash)
    REFERENCES simulation_run_datasets(environment,scope_id,strategy_account_id,
      run_id,dataset_hash),
  FOREIGN KEY (observation_hash)
    REFERENCES observation_market_events(observation_hash)
);

CREATE OR REPLACE FUNCTION simulation_dataset_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected_hash text;
BEGIN
  SELECT manifest_json #>> '{scenario,dataset_hash}' INTO expected_hash
    FROM simulation_runs WHERE environment=NEW.environment
      AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
      AND run_id=NEW.run_id;
  IF expected_hash IS DISTINCT FROM NEW.dataset_hash THEN
    RAISE EXCEPTION 'simulation dataset differs from registered run';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_run_datasets_identity ON simulation_run_datasets;
CREATE TRIGGER simulation_run_datasets_identity BEFORE INSERT ON simulation_run_datasets
  FOR EACH ROW EXECUTE FUNCTION simulation_dataset_guard();

CREATE OR REPLACE FUNCTION simulation_dataset_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulation dataset is immutable'; END $$;
DROP TRIGGER IF EXISTS simulation_run_datasets_immutable ON simulation_run_datasets;
CREATE TRIGGER simulation_run_datasets_immutable BEFORE UPDATE OR DELETE
  ON simulation_run_datasets FOR EACH ROW
  EXECUTE FUNCTION simulation_dataset_reject_mutation();
DROP TRIGGER IF EXISTS simulation_run_dataset_items_immutable ON simulation_run_dataset_items;
CREATE TRIGGER simulation_run_dataset_items_immutable BEFORE UPDATE OR DELETE
  ON simulation_run_dataset_items FOR EACH ROW
  EXECUTE FUNCTION simulation_dataset_reject_mutation();

-- Match 061's additive simulation-role boundary without granting any native
-- observation, live account or projection write capability.
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['simulation_run_datasets',
                               'simulation_run_dataset_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item);
    EXECUTE format('DROP POLICY IF EXISTS simulation_preserve_existing_grants ON public.%I', item);
    EXECUTE format('CREATE POLICY simulation_preserve_existing_grants ON public.%I
      AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true)', item);
    EXECUTE format('DROP POLICY IF EXISTS simulation_experiment_only ON public.%I', item);
    EXECUTE format('CREATE POLICY simulation_experiment_only ON public.%I
      AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
      USING (environment = ''experiment'') WITH CHECK (environment = ''experiment'')', item);
    EXECUTE format('REVOKE ALL ON public.%I FROM moeazi_simulation_writer', item);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO moeazi_simulation_writer', item);
  END LOOP;
END $$;

COMMIT;
