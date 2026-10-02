BEGIN;

-- A live receipt is a distinct authority class. Existing experiment receipts
-- remain experiment-only and cannot be promoted by changing their JSON body.
ALTER TABLE finance_calculation_receipts
  DROP CONSTRAINT IF EXISTS finance_calculation_receipts_authority_class_check;
ALTER TABLE finance_calculation_receipts
  ADD CONSTRAINT finance_calculation_receipts_authority_class_check
  CHECK (authority_class IN ('experiment_only', 'live_native'));

COMMIT;
