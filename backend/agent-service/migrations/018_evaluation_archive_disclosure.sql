BEGIN;

ALTER TABLE evaluation_runs
  ADD COLUMN IF NOT EXISTS lifecycle_admitted_body jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='evaluation_runs_lifecycle_admitted_body_object'
        AND conrelid='evaluation_runs'::regclass) THEN
    ALTER TABLE evaluation_runs
      ADD CONSTRAINT evaluation_runs_lifecycle_admitted_body_object CHECK (
        lifecycle_admitted_body IS NULL OR jsonb_typeof(lifecycle_admitted_body) = 'object'
      );
  END IF;
END $$;

COMMIT;
