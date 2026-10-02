-- Disposable assertion for Feature 36's append-only local fixture tables.
SELECT to_regclass('promotion_decisions') IS NOT NULL AS promotion_decisions_exists;
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('promotion_scopes_immutable', 'promotion_candidates_immutable', 'promotion_plans_immutable', 'promotion_decisions_immutable') AND NOT tgisinternal) <> 4 THEN
    RAISE EXCEPTION 'Feature 36 immutable trigger closure is incomplete';
  END IF;
END $$;
