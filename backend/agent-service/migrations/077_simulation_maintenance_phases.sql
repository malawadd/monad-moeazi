BEGIN;

-- Selection is a separate immutable receipt: recovery cannot select another
-- owner's close command after the selected command has already submitted.
ALTER TABLE simulation_phase_receipts
  DROP CONSTRAINT IF EXISTS simulation_phase_receipts_phase_check;
ALTER TABLE simulation_phase_receipts
  ADD CONSTRAINT simulation_phase_receipts_phase_check CHECK (phase IN
    ('controls','fold','checkpoint','entry','cursor','settlement','protection',
     'resolution','maintenance_select','maintenance'));

COMMIT;
