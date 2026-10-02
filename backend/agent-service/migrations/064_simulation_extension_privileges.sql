BEGIN;

-- Timescale 2.28.2 exposes job config/history and catalog rows through PUBLIC.
-- A per-role REVOKE cannot override PUBLIC. Keep the simulation startup guard
-- strict and remove those ambient reads; current app services use postgres.
-- Refuse unknown versions/consumers rather than silently changing their access.
DO $$
DECLARE item text; extension_version text; relation_oid oid;
  reviewed text[] := ARRAY[
    '_timescaledb_cache.cache_inval_bgw_job',
    '_timescaledb_cache.cache_inval_extension',
    '_timescaledb_cache.cache_inval_hypertable',
    '_timescaledb_catalog.bgw_job',
    '_timescaledb_catalog.chunk',
    '_timescaledb_catalog.chunk_column_stats',
    '_timescaledb_catalog.chunk_constraint',
    '_timescaledb_catalog.chunk_rewrite',
    '_timescaledb_catalog.compression_algorithm',
    '_timescaledb_catalog.compression_chunk_size',
    '_timescaledb_catalog.compression_settings',
    '_timescaledb_catalog.continuous_agg',
    '_timescaledb_catalog.continuous_aggs_bucket_function',
    '_timescaledb_catalog.continuous_aggs_hypertable_invalidation_log',
    '_timescaledb_catalog.continuous_aggs_invalidation_threshold',
    '_timescaledb_catalog.continuous_aggs_jobs_refresh_ranges',
    '_timescaledb_catalog.continuous_aggs_materialization_invalidation_log',
    '_timescaledb_catalog.continuous_aggs_materialization_ranges',
    '_timescaledb_catalog.continuous_aggs_watermark',
    '_timescaledb_catalog.dimension',
    '_timescaledb_catalog.dimension_slice',
    '_timescaledb_catalog.hypertable',
    '_timescaledb_catalog.metadata',
    '_timescaledb_catalog.tablespace',
    '_timescaledb_config.bgw_job',
    '_timescaledb_internal.bgw_job_stat',
    '_timescaledb_internal.bgw_policy_chunk_stats',
    '_timescaledb_internal.compressed_chunk_stats',
    '_timescaledb_internal.hypertable_chunk_local_size',
    'timescaledb_experimental.policies',
    'timescaledb_information.chunk_columnstore_settings',
    'timescaledb_information.chunk_compression_settings',
    'timescaledb_information.chunks',
    'timescaledb_information.compression_settings',
    'timescaledb_information.continuous_aggregates',
    'timescaledb_information.dimensions',
    'timescaledb_information.hypertable_columnstore_settings',
    'timescaledb_information.hypertable_compression_settings',
    'timescaledb_information.hypertables',
    'timescaledb_information.job_errors',
    'timescaledb_information.job_history',
    'timescaledb_information.job_stats',
    'timescaledb_information.jobs',
    'timescaledb_information.stat_chunk_activity'
  ];
BEGIN
  SELECT extversion INTO extension_version FROM pg_extension WHERE extname='timescaledb';
  IF extension_version IS NULL THEN RETURN; END IF;
  IF extension_version <> '2.28.2' THEN
    RAISE EXCEPTION 'review Timescale catalog privileges for this extension version';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE NOT rolsuper AND rolname NOT LIKE 'pg_%'
      AND rolname <> 'moeazi_simulation_writer'
      AND NOT pg_has_role(oid,'moeazi_simulation_writer','MEMBER')) THEN
    RAISE EXCEPTION 'review existing non-simulation consumers before removing PUBLIC catalog reads';
  END IF;
  FOREACH item IN ARRAY reviewed LOOP
    relation_oid := to_regclass(item);
    IF relation_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_class'::regclass AND d.objid=relation_oid
        AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
        AND e.extname='timescaledb') THEN
      RAISE EXCEPTION 'reviewed Timescale relation identity is missing or replaced: %', item;
    END IF;
    EXECUTE format('REVOKE SELECT ON TABLE %s FROM PUBLIC', relation_oid::regclass);
  END LOOP;
  -- Extension upgrades may recreate ambient grants. Startup refuses drift rather
  -- than granting an exception for all metadata schemas or read-only objects.
END $$;

COMMIT;
