\set ON_ERROR_STOP on
DROP SCHEMA IF EXISTS migration_014_fixture CASCADE;
CREATE SCHEMA migration_014_fixture;
SET search_path TO migration_014_fixture, public;
CREATE FUNCTION reject_dependency_safety_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
\ir ../../migrations/014_operational_secret_custody.sql

DO $$
DECLARE forbidden integer;
BEGIN
  SELECT count(*) INTO forbidden FROM information_schema.columns
  WHERE table_schema='migration_014_fixture' AND table_name LIKE 'operational_secret_%'
    AND column_name ~ '(plaintext|ciphertext|wrapped.*key|nonce|aad_body|fingerprint|bearer)';
  IF forbidden <> 0 THEN RAISE EXCEPTION 'custody schema contains forbidden material columns'; END IF;
  IF (SELECT count(*) FROM information_schema.tables
      WHERE table_schema='migration_014_fixture' AND table_name LIKE 'operational_secret_%') <> 7 THEN
    RAISE EXCEPTION 'custody table closure mismatch';
  END IF;
END $$;

INSERT INTO operational_secret_access_decisions
  (decision_id,tenant_scope,descriptor_id,class_id,purpose,consumer_id,consumer_version,
   capability,envelope_version,aad_hash,request_hash,descriptor_hash,envelope_hash,policy_hash,
   workload_registry_hash,outcome,reasons,decided_at,expires_at,idempotency_key,decision_hash)
VALUES ('osd_'||repeat('1',48),'tenant_'||repeat('a',16)||':account_'||repeat('b',16),
  'osc_'||repeat('2',48),'model_provider_byok','provider_call','provider_egress','v1',
  'invoke_provider',1,repeat('3',64),repeat('4',64),repeat('5',64),repeat('6',64),
  repeat('7',64),repeat('8',64),'allow','["authorized"]',now(),now()+interval '60 seconds',
  'upgrade:test:access',repeat('9',64));

INSERT INTO operational_secret_access_receipts
  (receipt_id,tenant_scope,descriptor_id,class_id,purpose,consumer_id,consumer_version,
   capability,envelope_version,aad_hash,policy_hash,decision_hash,request_hash,idempotency_key,
   stage,outcome,reason,sequence,occurred_at,receipt_hash)
VALUES ('osr_'||repeat('a',48),'tenant_'||repeat('a',16)||':account_'||repeat('b',16),
  'osc_'||repeat('2',48),'model_provider_byok','provider_call','provider_egress','v1',
  'invoke_provider',1,repeat('3',64),repeat('7',64),repeat('9',64),repeat('4',64),
  'upgrade:test:access','authorized_attempt','authorized','authorized',1,now(),repeat('b',64));

\ir ../../migrations/014_operational_secret_custody.sql

DO $$ BEGIN
  IF (SELECT count(*) FROM operational_secret_access_decisions) <> 1 OR
     (SELECT count(*) FROM operational_secret_access_receipts) <> 1 THEN
    RAISE EXCEPTION 'populated custody upgrade failed';
  END IF;
END $$;
RESET search_path;
DROP SCHEMA migration_014_fixture CASCADE;
