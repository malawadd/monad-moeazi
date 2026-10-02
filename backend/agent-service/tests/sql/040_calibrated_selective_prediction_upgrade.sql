-- Disposable assertion for Feature 37 local append-only fixture history.
SELECT to_regclass('selective_prediction_roots') IS NOT NULL AS selective_prediction_roots_exists;
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('selective_prediction_scopes_immutable', 'selective_prediction_artifacts_immutable', 'selective_prediction_roots_immutable') AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'Feature 37 immutable trigger closure is incomplete';
  END IF;
END $$;
