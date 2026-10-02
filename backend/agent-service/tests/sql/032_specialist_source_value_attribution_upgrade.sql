-- Disposable migration smoke assertions for fixture-only Feature 29 history.
SELECT to_regclass('source_value_runs') IS NOT NULL AS runs_present;
SELECT to_regclass('source_value_citations') IS NOT NULL AS citations_present;
SELECT to_regclass('source_value_role_statuses') IS NOT NULL AS statuses_present;
SELECT to_regclass('source_value_estimates') IS NOT NULL AS estimates_present;
SELECT to_regclass('source_value_request_claims') IS NOT NULL AS claims_present;
