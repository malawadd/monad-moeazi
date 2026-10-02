-- Disposable migration smoke assertions for fixture-only Feature 30 history.
SELECT to_regclass('evidence_integrity_runs') IS NOT NULL AS runs_present;
SELECT to_regclass('evidence_integrity_decisions') IS NOT NULL AS decisions_present;
SELECT to_regclass('evidence_integrity_request_claims') IS NOT NULL AS claims_present;
