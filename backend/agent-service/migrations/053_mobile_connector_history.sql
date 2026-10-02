CREATE TABLE IF NOT EXISTS mobile_connector_history (
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'activation', 'withdrawal')),
  status TEXT NOT NULL,
  observed_at BIGINT NOT NULL,
  provider_pins JSONB NOT NULL,
  PRIMARY KEY (operation_id, status, observed_at)
);
-- Sanitized history only: no wallet addresses, email, raw events, signatures, URLs or tokens.
