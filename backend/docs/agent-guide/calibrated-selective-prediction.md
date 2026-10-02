# Calibrated selective prediction

Feature 37 is an isolated Test Center replay over checked-in, synthetic, integer-only
forecast/label facts. It constructs conformal-style direction sets and return intervals,
then reduces them through deterministic shift, evidence, claim, cost and risk fixture
gates to `proposal_eligible`, `shadow_only`, or `abstain`.

Only local fixture history is persisted. Observe caps an otherwise eligible result to
`shadow_only`; isolated enforce may render the fixture decision. Neither mode creates a
proposal, calls a provider, reaches a network, changes customer authority, signs, or
executes. Raw confidence is not a calibrated probability. Feature 30, 31, and 36 rows
are selected explicitly and always remain `requires_revalidation` context.

Product calibration, proposal routing, signing, execution and external calls remain
unavailable. Activation additionally requires authoritative point-in-time forecasts and
labels, evidence/claim/integrity, cost and portfolio-risk owners, 200 effective mature
observations per market/horizon, powered chronological and Shadow evidence, review,
rollback runbooks, and separate approval for any billable work or product change.
