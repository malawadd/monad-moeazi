SELECT to_regclass('execution_quality_runs') IS NOT NULL AS runs_present;
SELECT to_regclass('execution_quality_decisions') IS NOT NULL AS decisions_present;
SELECT to_regclass('execution_quality_request_claims') IS NOT NULL AS claims_present;
