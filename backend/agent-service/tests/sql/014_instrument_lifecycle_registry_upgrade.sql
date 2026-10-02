-- Feature 07 local upgrade assertion: apply after 017 in an exact disposable schema.
SELECT to_regclass('instrument_operation_decisions') IS NOT NULL AS decisions_present;
SELECT to_regclass('instrument_lifecycle_events') IS NOT NULL AS events_present;
