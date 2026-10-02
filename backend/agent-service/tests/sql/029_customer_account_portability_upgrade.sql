-- Run in a caller-named disposable schema after migration 036 has been applied twice.
-- This is deliberately metadata-only: no customer rows or virtual package bytes are used.
DO $$
DECLARE required text[]:=ARRAY['portability_scopes','portability_policies','portability_synthetic_auth','portability_feature03_contexts','portability_requests','portability_domain_plans','portability_cutoffs','portability_source_record_refs','portability_field_decisions','portability_omissions','portability_domain_receipts','portability_file_descriptors','portability_manifests','portability_assembly_receipts','portability_verification_receipts','portability_grants','portability_delivery_attempts','portability_delivery_receipts','portability_cleanup_receipts','portability_root_manifests','portability_state_snapshots','portability_test_center_bundles','portability_request_claims','portability_conflicts']; t text;
BEGIN
 FOREACH t IN ARRAY required LOOP
  IF to_regclass(t) IS NULL THEN RAISE EXCEPTION 'portability_036_table_missing:%',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t::regclass AND tgname='portability_no_mutation') THEN RAISE EXCEPTION 'portability_append_only_missing:%',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=t AND column_name='payload_hash') THEN RAISE EXCEPTION 'portability_payload_hash_missing:%',t; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='portability_delivery_attempts'::regclass AND contype='u') THEN RAISE EXCEPTION 'portability_attempt_order_unique_missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='portability_cleanup_receipts'::regclass AND contype='c') THEN RAISE EXCEPTION 'portability_cleanup_check_missing'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid IN (SELECT unnest(required)::regclass) AND contype='f') < 20 THEN RAISE EXCEPTION 'portability_scope_fk_coverage_missing'; END IF;
END $$;
-- Repository harness supplies concrete probes for orphan/fork/gap/scope/path/nonce/attempt/root,
-- conflict durability and corrupt readback; this query makes the migration shape auditable too.
SELECT c.conrelid::regclass AS table_name,c.contype,c.conname
FROM pg_constraint c WHERE c.conrelid::regclass::text LIKE 'portability_%' ORDER BY 1,2,3;
