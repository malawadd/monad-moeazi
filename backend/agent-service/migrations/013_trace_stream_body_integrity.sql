BEGIN;

-- Only newly persisted trace rows with an exact admitted body may be streamed.
-- Historical rows remain NULL and therefore fail closed rather than being guessed.
ALTER TABLE agent_trace_events
  ADD COLUMN IF NOT EXISTS lifecycle_admitted_body text;

COMMIT;
