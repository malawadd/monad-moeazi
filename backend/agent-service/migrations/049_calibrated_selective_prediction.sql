-- Local Feature 37 fixture receipts only; no product calibration or proposal routing.
CREATE TABLE IF NOT EXISTS selective_prediction_scopes (scope_hash char(64) PRIMARY KEY, operator_test_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS selective_prediction_artifacts (artifact_hash char(64) PRIMARY KEY, scope_hash char(64) NOT NULL REFERENCES selective_prediction_scopes(scope_hash), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS selective_prediction_roots (root_hash char(64) PRIMARY KEY, artifact_hash char(64), decision text NOT NULL CHECK (decision IN ('proposal_eligible','shadow_only','abstain')), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS selective_prediction_roots_created_idx ON selective_prediction_roots(created_at DESC);
CREATE OR REPLACE FUNCTION selective_prediction_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'selective prediction records are append-only'; END $$;
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['selective_prediction_scopes', 'selective_prediction_artifacts', 'selective_prediction_roots'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(relation_name) AND tgname = relation_name || '_immutable' AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION selective_prediction_immutable()', relation_name || '_immutable', relation_name);
    END IF;
  END LOOP;
END $$;
