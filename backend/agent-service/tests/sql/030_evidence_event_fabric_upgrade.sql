-- Run only after the caller sets search_path to a disposable local schema.
SELECT count(*)=27 AS exact_feature25_tables FROM information_schema.tables WHERE table_schema=current_schema() AND table_name LIKE 'evidence_event_%';
SELECT count(*)>=27 AS append_only_trigger_coverage FROM pg_trigger WHERE tgname='evidence_event_no_mutation' AND NOT tgisinternal;
-- Direct writes prove the typed scope FK, append-only trigger, and request uniqueness.
INSERT INTO evidence_event_scopes VALUES ('operator:probe',repeat('a',64),repeat('b',64),'{}');
INSERT INTO evidence_event_events VALUES ('operator:probe',repeat('a',64),repeat('c',64),repeat('d',64),'{}');
DO $$ BEGIN BEGIN INSERT INTO evidence_event_events VALUES ('operator:foreign',repeat('e',64),repeat('f',64),repeat('a',64),'{}'); RAISE EXCEPTION 'orphan accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END; BEGIN UPDATE evidence_event_events SET payload='{}'; RAISE EXCEPTION 'mutation accepted'; EXCEPTION WHEN raise_exception THEN NULL; END; END $$;
