SELECT to_regclass('shadow_tca_runs') IS NOT NULL AS runs_present;
SELECT to_regclass('shadow_tca_receipts') IS NOT NULL AS receipts_present;
SELECT to_regclass('shadow_tca_request_claims') IS NOT NULL AS claims_present;
