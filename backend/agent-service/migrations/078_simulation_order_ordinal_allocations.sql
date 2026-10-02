BEGIN;

-- One account/run writer allocates the ordinal before either an ordinary entry
-- or an authenticated maintenance reduction can reserve financial capacity.
CREATE TABLE IF NOT EXISTS simulation_order_ordinal_allocations (
  environment text NOT NULL CHECK (environment='experiment'),
  scope_id text NOT NULL, strategy_account_id text NOT NULL,
  run_id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  allocation_kind text NOT NULL CHECK (allocation_kind IN ('entry','maintenance')),
  allocation_key text NOT NULL CHECK (length(allocation_key) BETWEEN 1 AND 200),
  order_ordinal bigint NOT NULL CHECK (order_ordinal>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,scope_id,strategy_account_id,run_id,
    allocation_kind,allocation_key),
  UNIQUE(environment,scope_id,strategy_account_id,run_id,order_ordinal),
  FOREIGN KEY(environment,scope_id,strategy_account_id,run_id)
    REFERENCES simulation_runs(environment,scope_id,strategy_account_id,run_id)
);

CREATE OR REPLACE FUNCTION simulation_guard_order_ordinal_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_manifest text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'simulation order ordinal allocation is immutable';
  END IF;
  SELECT manifest_hash INTO expected_manifest FROM simulation_runs
    WHERE environment=NEW.environment AND scope_id=NEW.scope_id
      AND strategy_account_id=NEW.strategy_account_id AND run_id=NEW.run_id
    FOR UPDATE;
  IF expected_manifest IS NULL OR expected_manifest<>NEW.manifest_hash THEN
    RAISE EXCEPTION 'simulation ordinal differs from its frozen run';
  END IF;
  IF EXISTS (SELECT 1 FROM simulation_orders o
      WHERE o.environment=NEW.environment AND o.scope_id=NEW.scope_id
        AND o.strategy_account_id=NEW.strategy_account_id AND o.run_id=NEW.run_id
        AND o.order_ordinal=NEW.order_ordinal)
    OR EXISTS (SELECT 1 FROM simulation_order_preparations p
      WHERE p.environment=NEW.environment AND p.scope_id=NEW.scope_id
        AND p.strategy_account_id=NEW.strategy_account_id AND p.run_id=NEW.run_id
        AND p.order_ordinal=NEW.order_ordinal)
    OR EXISTS (SELECT 1 FROM simulation_entry_progress e
      WHERE e.environment=NEW.environment AND e.scope_id=NEW.scope_id
        AND e.strategy_account_id=NEW.strategy_account_id AND e.run_id=NEW.run_id
        AND e.step='admission' AND e.payload_json->>'orderOrdinal'=NEW.order_ordinal::text)
    OR EXISTS (SELECT 1 FROM simulation_maintenance_reductions m
      WHERE m.environment=NEW.environment AND m.scope_id=NEW.scope_id
        AND m.strategy_account_id=NEW.strategy_account_id AND m.run_id=NEW.run_id
        AND m.order_ordinal=NEW.order_ordinal) THEN
    RAISE EXCEPTION 'simulation ordinal collides with durable prior work';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_order_ordinal_allocation_guard
  ON simulation_order_ordinal_allocations;
CREATE TRIGGER simulation_order_ordinal_allocation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON simulation_order_ordinal_allocations
  FOR EACH ROW EXECUTE FUNCTION simulation_guard_order_ordinal_allocation();

ALTER TABLE simulation_maintenance_reductions
  ADD COLUMN IF NOT EXISTS order_ordinal bigint;
ALTER TABLE simulation_maintenance_reductions
  DROP CONSTRAINT IF EXISTS simulation_maintenance_order_ordinal_positive;
ALTER TABLE simulation_maintenance_reductions
  ADD CONSTRAINT simulation_maintenance_order_ordinal_positive
  CHECK (order_ordinal>0);
ALTER TABLE simulation_maintenance_reductions
  ALTER COLUMN order_ordinal SET NOT NULL;
ALTER TABLE simulation_maintenance_reductions
  DROP CONSTRAINT IF EXISTS simulation_maintenance_order_ordinal_body;
ALTER TABLE simulation_maintenance_reductions
  ADD CONSTRAINT simulation_maintenance_order_ordinal_body
  CHECK ((receipt_json->>'order_ordinal')::bigint IS NOT DISTINCT FROM order_ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS simulation_maintenance_order_ordinal_unique
  ON simulation_maintenance_reductions(environment,scope_id,
    strategy_account_id,run_id,order_ordinal);

CREATE OR REPLACE FUNCTION simulation_guard_allocated_ordinal_use()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_kind text; expected_key text; expected_ordinal bigint;
BEGIN
  IF TG_TABLE_NAME='simulation_maintenance_reductions' THEN
    expected_kind:='maintenance'; expected_key:=NEW.command_id;
    expected_ordinal:=NEW.order_ordinal;
  ELSE
    IF NEW.step<>'admission' THEN RETURN NEW; END IF;
    expected_kind:='entry'; expected_key:=NEW.request_id;
    expected_ordinal:=(NEW.payload_json->>'orderOrdinal')::bigint;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM simulation_order_ordinal_allocations a
    WHERE a.environment=NEW.environment AND a.scope_id=NEW.scope_id
      AND a.strategy_account_id=NEW.strategy_account_id AND a.run_id=NEW.run_id
      AND a.manifest_hash=NEW.manifest_hash
      AND a.allocation_kind=expected_kind AND a.allocation_key=expected_key
      AND a.order_ordinal=expected_ordinal) THEN
    RAISE EXCEPTION 'simulation order ordinal lacks a scoped allocation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_maintenance_ordinal_guard
  ON simulation_maintenance_reductions;
CREATE TRIGGER simulation_maintenance_ordinal_guard BEFORE INSERT
  ON simulation_maintenance_reductions FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_allocated_ordinal_use();
DROP TRIGGER IF EXISTS simulation_entry_ordinal_guard
  ON simulation_entry_progress;
CREATE TRIGGER simulation_entry_ordinal_guard BEFORE INSERT
  ON simulation_entry_progress FOR EACH ROW
  EXECUTE FUNCTION simulation_guard_allocated_ordinal_use();

ALTER TABLE simulation_order_ordinal_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_ordinal_permissive
  ON simulation_order_ordinal_allocations;
CREATE POLICY simulation_ordinal_permissive ON simulation_order_ordinal_allocations
  AS PERMISSIVE FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS simulation_ordinal_experiment
  ON simulation_order_ordinal_allocations;
CREATE POLICY simulation_ordinal_experiment ON simulation_order_ordinal_allocations
  AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
  USING(environment='experiment') WITH CHECK(environment='experiment');
REVOKE ALL ON simulation_order_ordinal_allocations FROM moeazi_simulation_writer;
GRANT SELECT,INSERT ON simulation_order_ordinal_allocations
  TO moeazi_simulation_writer;

COMMIT;
