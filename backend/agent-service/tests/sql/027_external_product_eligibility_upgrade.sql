-- Opt-in disposable schema verification for Feature 22 migration 034.
\if :{?eligibility_test_schema}
\else
\quit
\endif
SELECT format('DROP SCHEMA IF EXISTS %I CASCADE', :'eligibility_test_schema') \gexec
SELECT format('CREATE SCHEMA %I', :'eligibility_test_schema') \gexec
SELECT format('SET search_path TO %I', :'eligibility_test_schema') \gexec
\ir ../../migrations/034_external_product_eligibility.sql
\ir ../../migrations/034_external_product_eligibility.sql
DO $$
DECLARE n text; a char(64):=repeat('a',64); b char(64):=repeat('b',64);
BEGIN
 FOREACH n IN ARRAY ARRAY['scopes','feature21_contexts','sources','owner_claims','attribute_assertions','product_bindings','venue_bindings','rulepacks','clauses','golden_manifests','golden_case_receipts','changes','quorum_bindings','activation_receipts','requests','decisions','leaf_results','lifecycle_transitions','artifacts','test_center_bundles','request_claims','conflicts'] LOOP
  IF to_regclass('product_eligibility_'||n) IS NULL THEN RAISE EXCEPTION 'missing %',n; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('product_eligibility_'||n) AND tgname='product_eligibility_no_mutation') THEN RAISE EXCEPTION 'missing trigger %',n; END IF;
 END LOOP;
 IF to_regclass('product_eligibility_current_fixture_projection') IS NULL THEN RAISE EXCEPTION 'missing projection'; END IF;
 INSERT INTO product_eligibility_scopes VALUES('operator-a',a,'{}'),('operator-b',b,'{}');
 INSERT INTO product_eligibility_requests VALUES('operator-a',a,repeat('1',64),repeat('3',64),repeat('4',64),repeat('5',64),'{}');
 INSERT INTO product_eligibility_decisions VALUES('operator-a',a,repeat('2',64),repeat('1',64),now(),'{}');
 BEGIN INSERT INTO product_eligibility_decisions VALUES('operator-b',b,repeat('6',64),repeat('1',64),now(),'{}'); RAISE EXCEPTION 'cross scope accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN INSERT INTO product_eligibility_sources VALUES('operator-a',a,'source:fixture',0,repeat('7',64),NULL,'{}'); RAISE EXCEPTION 'invalid revision accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO product_eligibility_activation_receipts VALUES('operator-a',a,1,repeat('8',64),repeat('9',64),'{}'); RAISE EXCEPTION 'activation predecessor accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE product_eligibility_decisions SET payload='{}'; RAISE EXCEPTION 'mutation accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'product_eligibility_append_only' THEN RAISE; END IF; END;
END $$;
SELECT format('DROP SCHEMA %I CASCADE', :'eligibility_test_schema') \gexec
