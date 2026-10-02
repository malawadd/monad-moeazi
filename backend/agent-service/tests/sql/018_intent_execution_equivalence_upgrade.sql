-- Disposable-schema verification for migration 023. Run after baseline migrations.
\set ON_ERROR_STOP on
\ir ../../migrations/023_intent_execution_equivalence.sql
SELECT to_regclass('equivalence_receipts') IS NOT NULL AS receipt_table_exists;
SELECT to_regclass('equivalence_request_receipts') IS NOT NULL AS idempotency_table_exists;
