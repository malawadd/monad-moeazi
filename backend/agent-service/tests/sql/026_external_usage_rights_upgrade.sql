-- Opt-in disposable-schema verification for migration 033. Invoke only with
-- psql -v usage_rights_test_schema=a_random_disposable_schema -f this_file.
\if :{?usage_rights_test_schema}
\else
\quit
\endif
SELECT format('DROP SCHEMA IF EXISTS %I CASCADE', :'usage_rights_test_schema') \gexec
SELECT format('CREATE SCHEMA %I', :'usage_rights_test_schema') \gexec
SELECT format('SET search_path TO %I', :'usage_rights_test_schema') \gexec
\ir ../../migrations/033_external_usage_rights.sql
\ir ../../migrations/033_external_usage_rights.sql
DO $$
DECLARE name text; scope_a char(64) := repeat('a',64); scope_b char(64) := repeat('b',64);
BEGIN
  FOREACH name IN ARRAY ARRAY['usage_rights_scopes','usage_rights_feature03_contexts','usage_rights_sources','usage_rights_source_heads','usage_rights_owner_attestations','usage_rights_rulepacks','usage_rights_assertions','usage_rights_golden_manifests','usage_rights_golden_case_receipts','usage_rights_rulepack_changes','usage_rights_activation_receipts','usage_rights_subjects','usage_rights_lineage_nodes','usage_rights_lineage_edges','usage_rights_operation_requests','usage_rights_decisions','usage_rights_leaf_matches','usage_rights_obligation_requirements','usage_rights_obligation_receipts','usage_rights_lifecycle_transitions','usage_rights_artifacts','usage_rights_test_center_bundles','usage_rights_request_claims','usage_rights_conflicts'] LOOP
    IF to_regclass(name) IS NULL THEN RAISE EXCEPTION 'missing table %',name; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(name) AND tgname='usage_rights_no_mutation') THEN RAISE EXCEPTION 'missing append trigger %',name; END IF;
  END LOOP;
  IF to_regclass('usage_rights_current_fixture_projection') IS NULL THEN RAISE EXCEPTION 'missing safe projection'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='usage_rights_decision_request_fk' AND conrelid='usage_rights_decisions'::regclass) THEN RAISE EXCEPTION 'missing decision request FK'; END IF;
  INSERT INTO usage_rights_scopes VALUES ('operator-a',scope_a,'{}'),('operator-b',scope_b,'{}');
  INSERT INTO usage_rights_operation_requests VALUES ('operator-a',scope_a,repeat('1',64),'{}');
  INSERT INTO usage_rights_decisions VALUES ('operator-a',scope_a,repeat('2',64),repeat('1',64),NULL,now(),'{}');
  BEGIN INSERT INTO usage_rights_decisions VALUES ('operator-b',scope_b,repeat('3',64),repeat('1',64),NULL,now(),'{}'); RAISE EXCEPTION 'cross-scope FK accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN INSERT INTO usage_rights_sources VALUES ('operator-a',scope_a,'source:fixture',0,repeat('4',64),NULL,'{}'); RAISE EXCEPTION 'revision check accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE usage_rights_decisions SET payload='{}'; RAISE EXCEPTION 'append-only mutation accepted'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'usage_rights_append_only' THEN RAISE; END IF;
  END;
END $$;
SELECT format('DROP SCHEMA %I CASCADE', :'usage_rights_test_schema') \gexec
