BEGIN;

ALTER TABLE finance_live_uniswap_attempt_bindings
  ADD COLUMN IF NOT EXISTS vault_address text,
  ADD COLUMN IF NOT EXISTS executor_address text,
  ADD COLUMN IF NOT EXISTS vault_code_hash text,
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS from_block numeric,
  ADD COLUMN IF NOT EXISTS vault_program_hash text,
  ADD COLUMN IF NOT EXISTS vault_policy_hash text,
  ADD COLUMN IF NOT EXISTS vault_capital_units finance_native_units,
  ADD COLUMN IF NOT EXISTS vault_max_buy_units finance_native_units,
  ADD COLUMN IF NOT EXISTS vault_expires_at numeric;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='finance_live_vault_attempt_identity') THEN
    ALTER TABLE finance_live_uniswap_attempt_bindings
      ADD CONSTRAINT finance_live_vault_attempt_identity CHECK (
        (vault_address IS NULL AND executor_address IS NULL
          AND vault_code_hash IS NULL AND order_id IS NULL AND from_block IS NULL
          AND vault_program_hash IS NULL AND vault_policy_hash IS NULL
          AND vault_capital_units IS NULL AND vault_max_buy_units IS NULL
          AND vault_expires_at IS NULL)
        OR (vault_address ~ '^0x[0-9a-f]{40}$'
          AND executor_address ~ '^0x[0-9a-f]{40}$'
          AND vault_code_hash ~ '^0x[0-9a-f]{64}$'
          AND order_id ~ '^0x[0-9a-f]{64}$'
          AND from_block > 0 AND from_block=trunc(from_block)
          AND vault_program_hash ~ '^[0-9a-f]{64}$'
          AND vault_policy_hash ~ '^[0-9a-f]{64}$'
          AND vault_capital_units > 0 AND vault_max_buy_units > 0
          AND vault_max_buy_units <= vault_capital_units
          AND vault_expires_at > 0 AND vault_expires_at=trunc(vault_expires_at))
      );
  END IF;
END $$;

ALTER TABLE finance_live_uniswap_fills
  ALTER COLUMN user_operation_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS vault_address text,
  ADD COLUMN IF NOT EXISTS order_id text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='finance_live_uniswap_fill_source') THEN
    ALTER TABLE finance_live_uniswap_fills
      ADD CONSTRAINT finance_live_uniswap_fill_source CHECK (
        (user_operation_hash IS NOT NULL AND vault_address IS NULL AND order_id IS NULL)
        OR (user_operation_hash IS NULL AND vault_address ~ '^0x[0-9a-f]{40}$'
          AND order_id ~ '^0x[0-9a-f]{64}$')
      );
  END IF;
END $$;

COMMIT;
