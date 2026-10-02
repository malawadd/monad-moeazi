-- Disposable-local upgrade assertion for Feature 35 append-only tables.
SELECT to_regclass('public.decision_memory_scopes') IS NOT NULL AS scopes_present;
SELECT to_regclass('public.decision_memory_episodes') IS NOT NULL AS episodes_present;
SELECT to_regclass('public.decision_memory_outcome_revisions') IS NOT NULL AS outcomes_present;
