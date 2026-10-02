-- Caller supplies a disposable search_path before this check.
\i agent-service/migrations/035_customer_contestation.sql
\i agent-service/migrations/035_customer_contestation.sql
SELECT to_regclass('customer_contestation_cases') IS NOT NULL AS cases_table;
DO $$ BEGIN
 INSERT INTO customer_contestation_scopes VALUES('operator:sql','a'||repeat('0',63),'a'||repeat('0',63),'{}');
 BEGIN UPDATE customer_contestation_scopes SET payload='{}' WHERE operator_test_id='operator:sql'; RAISE EXCEPTION 'append-only did not reject'; EXCEPTION WHEN others THEN NULL; END;
END $$;
