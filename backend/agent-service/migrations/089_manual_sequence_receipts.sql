BEGIN;

CREATE TABLE IF NOT EXISTS manual_sequence_sessions (
  session_id uuid PRIMARY KEY,
  preview_id uuid NOT NULL UNIQUE,
  operator_subject text NOT NULL,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
  catalog_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','uncertain','partially_failed')),
  continue_after_failure boolean NOT NULL DEFAULT false,
  requires_acknowledgement boolean NOT NULL DEFAULT false,
  acknowledged_high_impact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS manual_sequence_sessions_operator_recent
  ON manual_sequence_sessions(operator_subject, created_at DESC);

CREATE TABLE IF NOT EXISTS manual_sequence_step_receipts (
  session_id uuid NOT NULL REFERENCES manual_sequence_sessions(session_id),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  function_id text NOT NULL,
  identity_mode text NOT NULL CHECK (identity_mode IN ('operator','fixture')),
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','uncertain','skipped')),
  arguments_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb,
  error_json jsonb,
  idempotency_key text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS manual_sequence_steps_recent
  ON manual_sequence_step_receipts(session_id, ordinal);

COMMIT;
