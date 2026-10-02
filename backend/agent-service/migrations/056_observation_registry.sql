BEGIN;

-- Immutable observation metadata in the existing Timescale/PostgreSQL service.
-- Raw response bytes stay behind governed references; finance reads only the
-- separately admitted account snapshot by exact hash.
CREATE TABLE IF NOT EXISTS observation_instrument_versions (
  instrument_version_id text PRIMARY KEY,
  venue_id text NOT NULL,
  native_instrument_id text NOT NULL,
  product_kind text NOT NULL CHECK (product_kind IN ('spot', 'perpetual')),
  registry_hash text NOT NULL CHECK (registry_hash ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, native_instrument_id, product_kind, registry_hash)
);

CREATE TABLE IF NOT EXISTS observation_market_events (
  observation_hash text PRIMARY KEY CHECK (observation_hash ~ '^[0-9a-f]{64}$'),
  instrument_version_id text NOT NULL REFERENCES observation_instrument_versions(instrument_version_id),
  source_id text NOT NULL,
  source_event_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('recorded_native', 'synthetic_fault', 'documented_example')),
  source_rights_ref text NOT NULL,
  raw_payload_hash text NOT NULL CHECK (raw_payload_hash ~ '^[0-9a-f]{64}$'),
  raw_payload_ref text NOT NULL,
  observation_kind text NOT NULL,
  event_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  sequence bigint,
  continuity text NOT NULL CHECK (continuity IN ('snapshot_only', 'sequenced')),
  block_number bigint,
  block_hash text,
  finality text NOT NULL,
  normalized_body jsonb NOT NULL CHECK (jsonb_typeof(normalized_body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, instrument_version_id, source_event_id),
  CHECK (event_at <= available_at AND available_at <= received_at),
  CHECK ((continuity = 'snapshot_only' AND sequence IS NULL)
     OR (continuity = 'sequenced' AND sequence IS NOT NULL)),
  CHECK ((block_number IS NULL) = (block_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS observation_market_events_instrument_event
  ON observation_market_events(instrument_version_id, event_at DESC);

CREATE TABLE IF NOT EXISTS observation_evidence_snapshots (
  snapshot_hash text PRIMARY KEY CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  cutoff_at timestamptz NOT NULL,
  instrument_version_ids jsonb NOT NULL CHECK (jsonb_typeof(instrument_version_ids) = 'array'),
  accepted_observation_hashes jsonb NOT NULL CHECK (jsonb_typeof(accepted_observation_hashes) = 'array'),
  excluded jsonb NOT NULL CHECK (jsonb_typeof(excluded) = 'array'),
  source_rights_refs jsonb NOT NULL CHECK (jsonb_typeof(source_rights_refs) = 'array'),
  has_gap boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS observation_account_snapshots (
  snapshot_hash text PRIMARY KEY CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  environment text NOT NULL CHECK (environment IN ('live', 'experiment')),
  scope_id text NOT NULL,
  strategy_account_id text NOT NULL,
  source_account_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'quarantined', 'incomplete')),
  origin text NOT NULL CHECK (origin IN ('native_verified', 'recorded_fixture')),
  observed_balances jsonb NOT NULL CHECK (jsonb_typeof(observed_balances) = 'array'),
  observed_positions jsonb NOT NULL CHECK (jsonb_typeof(observed_positions) = 'array'),
  balances_complete boolean NOT NULL,
  positions_complete boolean NOT NULL,
  event_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  finality text NOT NULL,
  finality_at timestamptz,
  has_gap boolean NOT NULL,
  has_reorg boolean NOT NULL,
  rights_ref text NOT NULL,
  source_event_hash text NOT NULL CHECK (source_event_hash ~ '^[0-9a-f]{64}$'),
  source_payload_hash text NOT NULL CHECK (source_payload_hash ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL,
  registry_hash text NOT NULL CHECK (registry_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((environment = 'live' AND scope_id = 'live')
      OR (environment = 'experiment' AND scope_id <> 'live')),
  CHECK (event_at <= available_at AND available_at <= received_at AND available_at <= cutoff_at),
  CHECK (environment <> 'live' OR origin = 'native_verified')
);
CREATE INDEX IF NOT EXISTS observation_account_snapshots_scope_cutoff
  ON observation_account_snapshots(environment, scope_id, strategy_account_id, cutoff_at DESC);

CREATE OR REPLACE FUNCTION reject_observation_record_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'observation records are immutable; append a correction or new version';
END;
$$;

DROP TRIGGER IF EXISTS observation_instrument_versions_immutable ON observation_instrument_versions;
CREATE TRIGGER observation_instrument_versions_immutable BEFORE UPDATE OR DELETE
  ON observation_instrument_versions FOR EACH ROW EXECUTE FUNCTION reject_observation_record_change();
DROP TRIGGER IF EXISTS observation_market_events_immutable ON observation_market_events;
CREATE TRIGGER observation_market_events_immutable BEFORE UPDATE OR DELETE
  ON observation_market_events FOR EACH ROW EXECUTE FUNCTION reject_observation_record_change();
DROP TRIGGER IF EXISTS observation_evidence_snapshots_immutable ON observation_evidence_snapshots;
CREATE TRIGGER observation_evidence_snapshots_immutable BEFORE UPDATE OR DELETE
  ON observation_evidence_snapshots FOR EACH ROW EXECUTE FUNCTION reject_observation_record_change();
DROP TRIGGER IF EXISTS observation_account_snapshots_immutable ON observation_account_snapshots;
CREATE TRIGGER observation_account_snapshots_immutable BEFORE UPDATE OR DELETE
  ON observation_account_snapshots FOR EACH ROW EXECUTE FUNCTION reject_observation_record_change();

COMMIT;
