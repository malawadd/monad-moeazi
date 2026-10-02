BEGIN;

ALTER TABLE observation_account_snapshots
  ADD COLUMN IF NOT EXISTS coverage_scope text NOT NULL DEFAULT 'full_account';
ALTER TABLE observation_account_snapshots
  ADD COLUMN IF NOT EXISTS source_block_number text;
ALTER TABLE observation_account_snapshots
  ADD COLUMN IF NOT EXISTS source_block_hash text;

ALTER TABLE observation_account_snapshots
  DROP CONSTRAINT IF EXISTS observation_account_snapshots_coverage_scope_check;
ALTER TABLE observation_account_snapshots
  ADD CONSTRAINT observation_account_snapshots_coverage_scope_check
  CHECK (coverage_scope IN ('full_account', 'arbitrum_usdc_weth_spot'));

ALTER TABLE observation_account_snapshots
  DROP CONSTRAINT IF EXISTS observation_account_snapshots_managed_pair_live_check;
ALTER TABLE observation_account_snapshots
  ADD CONSTRAINT observation_account_snapshots_managed_pair_live_check
  CHECK (coverage_scope <> 'arbitrum_usdc_weth_spot' OR
         (environment = 'live' AND scope_id = 'live'));

ALTER TABLE observation_account_snapshots
  DROP CONSTRAINT IF EXISTS observation_account_snapshots_source_block_pair_check;
ALTER TABLE observation_account_snapshots
  ADD CONSTRAINT observation_account_snapshots_source_block_pair_check
  CHECK ((source_block_number IS NULL) = (source_block_hash IS NULL));

ALTER TABLE observation_account_snapshots
  DROP CONSTRAINT IF EXISTS observation_account_snapshots_managed_pair_block_check;
ALTER TABLE observation_account_snapshots
  ADD CONSTRAINT observation_account_snapshots_managed_pair_block_check
  CHECK (coverage_scope <> 'arbitrum_usdc_weth_spot' OR
         (source_block_number IS NOT NULL AND source_block_hash IS NOT NULL AND
          source_block_number ~ '^[1-9][0-9]*$' AND
          source_block_hash ~ '^0x[0-9a-f]{64}$'));

COMMIT;
