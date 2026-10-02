BEGIN;

-- The claim is consumed before venue I/O. A crash or lost response leaves
-- dispatching for account reconciliation; replay never submits a second order.
ALTER TABLE finance_submission_attempts
  DROP CONSTRAINT IF EXISTS finance_submission_attempts_status_check;
ALTER TABLE finance_submission_attempts
  ADD CONSTRAINT finance_submission_attempts_status_check
  CHECK (status IN ('possible', 'dispatching', 'confirmed', 'rejected'));

COMMIT;
