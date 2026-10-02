# Design — Calibrated Selective Prediction and Abstention

## State semantics

- `proposal_eligible`: analysis may create a typed proposal; it does not authorize
  approval, preflight, signing, submission, or fill.
- `shadow_only`: forecast and simulated outcome may be recorded, but no Approval or
  Autopilot proposal is created from it.
- `abstain`: no proposal; record the exact deterministic reason.

`shadow_only` is sticky downward even when the customer selected Autopilot. Existing
policy and execution gates remain independent.

## Proposed contracts

### `CalibrationSpec`

- market, horizon, outcome/neutral-band/cost definition;
- model family/model, prompt, route, evidence/integrity/claim policy versions;
- method/version, nonconformity or loss function, target coverage/risk;
- training/calibration window endpoints, embargo, minimum/effective sample method;
- refresh/expiry, grouping/regime policy, shift thresholds, and authorizer.

### `CalibrationArtifact`

- exact spec key/hash and settled-label cutoff;
- fitted parameters/nonconformity distribution or risk threshold;
- sample/effective sample, empirical coverage/risk, set/interval size;
- creation/expiry, quality, supported scope, and immutable artifact hash.

Changing any key dimension invalidates reuse.

### `PredictionReceipt`

- forecast/analysis/evidence/synthesis and calibration hashes;
- point/quantile/class forecast, calibrated interval/set/probability;
- target and empirical coverage/risk, sample count, created/expiry;
- market/horizon/outcome definition and no natural-language reasoning.

### `ShiftDiagnostic`

- recent coverage error, interval width, residual/nonconformity drift;
- evidence/source-quality and market volatility/liquidity drift;
- `inside | warning | outside | insufficient`, thresholds/version, and reasons.

### `ThresholdPolicy` and `EligibilityDecision`

The versioned policy freezes probability/lower-bound, interval-width, risk, cost,
quality, shift, and minimum-sample thresholds. Pure deterministic reduction returns the
state, reason codes, exact input hashes, and expiry. Models cannot set or override it.

## Data and flow

1. Store immutable forecast observations with event/observed times and all versions.
2. Mature labels only after the exact horizon and execution-cost definition is fully
   observable; corrections create revisions.
3. Build rolling point-in-time artifacts separately by market and horizon. Predeclared
   pooling is allowed only when evaluation proves it; no retroactive grouping.
4. Embargo overlapping outcomes and exclude labels unavailable at the artifact cutoff.
5. Produce a prediction receipt and shift diagnostic.
6. Require claim/integrity, evidence freshness, cost lower-bound, and portfolio risk
   gates in addition to calibration.
7. Return Shadow-only/abstain on insufficient data, stale artifact, configuration
   mismatch, shift, width failure, method failure, or non-positive conservative net edge.

Multi-horizon action requires every action-relevant horizon to pass its own artifact or
a predeclared family-wise conservative rule. Short-horizon calibration cannot stand in
for a longer horizon.

## Ownership

- Timescale stores forecast observations/outcomes, specs, artifacts, receipts, shift
  diagnostics, decisions, and detailed scorecards.
- Convex stores current safe calibration/abstention summary and proposal receipt ref.
- Redis may cache immutable artifacts by hash/expiry.
- Temporal owns maturation, refresh, and finite Evaluation Lab work.

## Failure behavior

- Insufficient/delayed labels: Shadow-only or abstain.
- Artifact stale/version mismatch: invalidate and reset.
- Shift threshold breach: never promote; Shadow-only or abstain.
- Method error/non-finite result: abstain.
- Excessive interval width: abstain rather than relax target.
- Model/prompt/route change: new artifact required.

## Later implementation sequence

1. Freeze forecast/outcome definitions and point-in-time storage.
2. Add offline artifacts/receipts and leakage tests.
3. Compare calibration methods in Evaluation Lab per market/horizon.
4. Add Shadow-only decisions and shift monitoring.
5. Accumulate mature paired evidence and operator review.
6. Consider production proposal eligibility only through a separate explicit activation.

Rollback disables artifact influence and returns to the previous proposal eligibility
path; stored forecasts/outcomes remain immutable.

## Local fixture boundary

Local replay uses checked-in factual fixtures and integer arithmetic. Observe projects
an eligible result as `shadow_only`; isolated enforce remains non-authorizing. Product
calibration, routing, signing, and execution are not implemented by this feature.
