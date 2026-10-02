BEGIN;

-- This is a single finalized-block quote receipt, not a book or a continuity
-- stream. The immutable JSON body is revalidated by the finance binder.
CREATE TABLE IF NOT EXISTS observation_uniswap_v3_quotes (
  quote_hash text PRIMARY KEY CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  chain_id integer NOT NULL CHECK (chain_id = 42161),
  venue text NOT NULL CHECK (venue = 'uniswap'),
  token_in text NOT NULL CHECK (token_in IN (
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1')),
  token_out text NOT NULL CHECK (token_out IN (
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1')),
  fee_tier integer NOT NULL CHECK (fee_tier = 3000),
  amount_in numeric(78,0) NOT NULL CHECK (amount_in > 0),
  amount_out numeric(78,0) NOT NULL CHECK (amount_out > 0),
  block_number numeric(78,0) NOT NULL CHECK (block_number > 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_at timestamptz NOT NULL,
  source_rights_ref text NOT NULL CHECK (
    source_rights_ref = 'arbitrum_finalized_rpc:uniswap_v3_quoter_v2'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (token_in <> token_out)
);
CREATE INDEX IF NOT EXISTS observation_uniswap_v3_quotes_pair_block
  ON observation_uniswap_v3_quotes(token_in, token_out, block_number DESC);

DROP TRIGGER IF EXISTS observation_uniswap_v3_quotes_immutable
  ON observation_uniswap_v3_quotes;
CREATE TRIGGER observation_uniswap_v3_quotes_immutable BEFORE UPDATE OR DELETE
  ON observation_uniswap_v3_quotes FOR EACH ROW EXECUTE FUNCTION reject_observation_record_change();

COMMIT;
