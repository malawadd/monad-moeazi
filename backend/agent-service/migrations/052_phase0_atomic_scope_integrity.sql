-- Additive, rerunnable fixture-history safeguards for Phase 0 local repositories.
-- No live product path reads these tables.
CREATE UNIQUE INDEX IF NOT EXISTS temporal_nonce_scope_request_uq
  ON temporal_nonce_leases(domain_id, signer_fingerprint, account_key, request_hash);
CREATE INDEX IF NOT EXISTS temporal_nonce_scope_state_idx
  ON temporal_nonce_leases(domain_id, signer_fingerprint, account_key, state);
CREATE INDEX IF NOT EXISTS instrument_event_scope_sequence_idx
  ON instrument_lifecycle_events(tenant_id, scope_key, native_sequence);
CREATE INDEX IF NOT EXISTS risk_reservation_scope_payload_idx
  ON risk_reservations(tenant_id, account_id, scope_key, reservation_hash);
CREATE INDEX IF NOT EXISTS risk_attempt_scope_receipt_idx
  ON risk_execution_attempts(tenant_id, account_id, scope_key, receipt_hash);

-- JSON payloads must agree with the scope columns used for isolation/readback.
CREATE OR REPLACE FUNCTION phase0_payload_scope_matches() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload->>'scope_key' IS NOT NULL AND NEW.payload->>'scope_key' <> NEW.scope_key THEN
    RAISE EXCEPTION 'phase0 payload scope conflicts with row scope';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['risk_source_observations','risk_input_manifests','risk_snapshots','risk_reservations','risk_execution_attempts','risk_reconciliation_receipts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'phase0_scope_check', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION phase0_payload_scope_matches()', 'phase0_scope_check', t);
  END LOOP;
END $$;
