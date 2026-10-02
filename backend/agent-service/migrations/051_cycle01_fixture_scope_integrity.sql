BEGIN;

-- Additive guards for Cycle 01 fixture histories.  NOT VALID preserves prior
-- immutable rows while enforcing canonical duplicate columns on new appends.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='eld_payload_scope_check') THEN
    ALTER TABLE evidence_lifecycle_decisions ADD CONSTRAINT eld_payload_scope_check CHECK (
      payload #>> '{scope,key}'=scope_key AND payload #>> '{scope,kind}'=scope_kind
    ) NOT VALID;
  END IF;
  -- Feature 04 stores its canonical authority fields as first-class columns,
  -- not a JSON payload.  Keep this migration compatible with that contract.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='operational_secret_access_decisions'
        AND column_name IN ('tenant_scope','descriptor_id','request_hash','descriptor_hash',
          'envelope_hash','policy_hash','workload_registry_hash')) <> 7 THEN
    RAISE EXCEPTION 'operational secret scalar authority columns are incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='eac_decision_payload_scope_check') THEN
    ALTER TABLE execution_artifact_decisions ADD CONSTRAINT eac_decision_payload_scope_check CHECK (
      payload #>> '{account_scope,key}'=scope_key AND payload #>> '{operation}'=operation
      AND payload #>> '{request_hash}'=request_hash
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ti_decision_payload_scope_check') THEN
    ALTER TABLE temporal_safety_decisions ADD CONSTRAINT ti_decision_payload_scope_check CHECK (
      payload #>> '{scope,key}'=scope_key AND payload #>> '{operation}'=operation
      AND payload #>> '{request_hash}'=request_hash
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ilr_decision_payload_scope_check') THEN
    ALTER TABLE instrument_operation_decisions ADD CONSTRAINT ilr_decision_payload_scope_check CHECK (
      payload #>> '{scope,tenant_id}'=tenant_id AND payload #>> '{operation}'=operation
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cdl_decision_payload_scope_check') THEN
    ALTER TABLE capability_decisions ADD CONSTRAINT cdl_decision_payload_scope_check CHECK (
      payload #>> '{scope,tenant_id}'=tenant_id AND payload #>> '{scope,account_id}'=account_id
      AND payload #>> '{scope,scope_key}'=scope_key AND payload #>> '{request_hash}'=request_hash
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='arr_reservation_payload_scope_check') THEN
    ALTER TABLE risk_reservations ADD CONSTRAINT arr_reservation_payload_scope_check CHECK (
      payload #>> '{scope,tenant_id}'=tenant_id AND payload #>> '{scope,account_id}'=account_id
      AND payload #>> '{scope,scope_key}'=scope_key
    ) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS instrument_decision_scope_request_unique
  ON instrument_operation_decisions(tenant_id,scope_key,decision_hash);
CREATE UNIQUE INDEX IF NOT EXISTS capability_grant_scope_hash_unique
  ON capability_grant_specs(tenant_id,account_id,scope_key,grant_hash);
CREATE UNIQUE INDEX IF NOT EXISTS risk_snapshot_scope_hash_unique
  ON risk_snapshots(tenant_id,account_id,scope_key,snapshot_hash);

COMMIT;
