SELECT to_regclass('portfolio_sizing_runs') IS NOT NULL AS runs_present;
SELECT to_regclass('portfolio_sizing_decisions') IS NOT NULL AS decisions_present;
SELECT to_regclass('portfolio_sizing_request_claims') IS NOT NULL AS claims_present;
