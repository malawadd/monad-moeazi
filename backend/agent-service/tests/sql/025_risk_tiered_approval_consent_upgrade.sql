-- Disposable schema verification; never point this file at product history.
BEGIN;
CREATE SCHEMA feature20_upgrade_test;
SET LOCAL search_path TO feature20_upgrade_test, public;
\ir ../../migrations/032_risk_tiered_approval_consent.sql
\ir ../../migrations/032_risk_tiered_approval_consent.sql
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['risk_tiered_consent_scopes','risk_tiered_consent_feature19_contexts','risk_tiered_consent_source_receipts','risk_tiered_consent_packets','risk_tiered_consent_nonce_consumptions','risk_tiered_consent_lifecycle_transitions','risk_tiered_consent_request_claims','risk_tiered_consent_conflicts','risk_tiered_consent_artifacts'] LOOP
    IF to_regclass(table_name) IS NULL THEN RAISE EXCEPTION 'missing Feature 20 table: %', table_name; END IF;
  END LOOP;
END $$;
INSERT INTO risk_tiered_consent_scopes VALUES ('operator_test','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','proposal_fixture','{}');
INSERT INTO risk_tiered_consent_packets VALUES ('operator_test','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',now(),'{}');
INSERT INTO risk_tiered_consent_nonce_consumptions VALUES ('operator_test','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','accepted','{}');
INSERT INTO risk_tiered_consent_lifecycle_transitions VALUES ('operator_test','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','{}');
DO $$ BEGIN
  BEGIN UPDATE risk_tiered_consent_packets SET payload='{"mutated":true}' WHERE operator_test_id='operator_test'; RAISE EXCEPTION 'append-only update was accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'risk_tiered_consent_append_only' THEN RAISE; END IF; END;
  BEGIN INSERT INTO risk_tiered_consent_nonce_consumptions VALUES ('operator_test','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','rejected','{}'); RAISE EXCEPTION 'double consumption was accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
DO $$ BEGIN
  IF (SELECT lifecycle_sequence FROM risk_tiered_consent_current_fixture_projection WHERE operator_test_id='operator_test') <> 1 THEN RAISE EXCEPTION 'current view did not fold lifecycle'; END IF;
END $$;
ROLLBACK;
