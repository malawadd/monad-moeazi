# Calibrated Selective Prediction and Deterministic Abstention

## Decision

**Approved for Evaluation Lab and Shadow — 88/100. Production proposal eligibility is
held pending market/horizon-specific evidence.**

This feature separates a model forecast from a deterministic uncertainty, shift, cost,
and abstention layer. Conformal methods are evaluated as calibration tools, not as
distribution-free trading-safety guarantees.

## Target user and problem

Raw model confidence and agent vote counts are not calibrated probabilities. Customers
need the system to abstain when outcome labels are sparse, artifacts are stale, market
conditions shifted, uncertainty is wide, or conservative net edge does not clear costs.

## Why implement it

- Gives every eligible proposal a horizon-specific uncertainty receipt.
- Measures and exposes the accuracy/coverage versus abstention/opportunity tradeoff.
- Defaults to Shadow or abstention when data or calibration is inadequate.
- Prevents an LLM from setting or relaxing eligibility thresholds.

## Why the mechanism should work

Adaptive conformal and conformal risk-control research provides testable ways to
calibrate observed prediction error under explicit assumptions. A deterministic layer
can combine the artifact with shift, evidence, claim, cost, and risk gates. Its useful
output is selective prediction and honest abstention, not guaranteed profit.

## Proposed benefit

| Hypothesis or invariant | Target | Confidence |
| --- | --- | --- |
| Action/proposal-eligible forecasts with fresh exact uncertainty receipt | 100% after any future cutover | High |
| False-positive eligible directional forecasts | Test 20–45% reduction | Medium-low |
| Realized calibration error | Test 15–35% reduction | Low-medium |
| Eligibility from insufficient/stale/shifted calibration | Zero | High |

Report absolute denominator, abstention rate, opportunity cost, selective risk, and net
Shadow utility. No PnL or individual-trade coverage claim is allowed.

## Assumptions matrix

| Assumption | Required response when false |
| --- | --- |
| Mature point-in-time labels exist for the exact market/horizon/version | Shadow-only or abstain |
| Calibration window excludes future and overlapping labels | Reject artifact |
| Model/prompt/route/evidence policy matches artifact key | Reset to Shadow-only |
| Shift remains inside the evaluated envelope | Flag and abstain/Shadow-only |
| Cost and neutral-band outcome definitions are frozen | Reject decision |

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.

## Local fixture status

Feature 37 is synthetic and local-only. It requires explicit same-operator Feature 30,
31, and 36 selections as revalidation-required lineage and cannot create proposals,
call providers, or alter product authority.
