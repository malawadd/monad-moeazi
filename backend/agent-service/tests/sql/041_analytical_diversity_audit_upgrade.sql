SELECT to_regclass('analytical_diversity_reports') IS NOT NULL AS analytical_diversity_reports_exists;
DO $$ BEGIN IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('analytical_diversity_scopes_immutable','analytical_diversity_reports_immutable') AND NOT tgisinternal) <> 2 THEN RAISE EXCEPTION 'Feature 38 immutable trigger closure is incomplete'; END IF; END $$;
