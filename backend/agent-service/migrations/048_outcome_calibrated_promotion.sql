-- Local fixture-only Feature 36 receipts. Never stores or mutates product configuration.
CREATE TABLE IF NOT EXISTS promotion_scopes (scope_hash char(64) PRIMARY KEY, operator_test_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS promotion_candidates (candidate_hash char(64) PRIMARY KEY, scope_hash char(64) NOT NULL REFERENCES promotion_scopes(scope_hash), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS promotion_plans (plan_hash char(64) PRIMARY KEY, candidate_hash char(64) NOT NULL REFERENCES promotion_candidates(candidate_hash), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS promotion_decisions (root_hash char(64) PRIMARY KEY, plan_hash char(64), decision text NOT NULL CHECK (decision IN ('eligible','hold','reject','demote','block','kill')), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS promotion_decisions_created_idx ON promotion_decisions(created_at DESC);
CREATE OR REPLACE FUNCTION promotion_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'promotion records are append-only'; END $$;
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['promotion_scopes', 'promotion_candidates', 'promotion_plans', 'promotion_decisions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(relation_name)
                   AND tgname = relation_name || '_immutable' AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION promotion_immutable()', relation_name || '_immutable', relation_name);
    END IF;
  END LOOP;
END $$;
