# Validation — Calibrated Shadow Execution and TCA Fidelity

## Baselines and datasets

- Current immediate-quote-as-full-fill behavior on identical frozen cases.
- Sequence-complete synthetic books, depth approximations, and Arbitrum AMM fixtures.
- Later certified reconciliation pairs, kept chronological and never used to rewrite
  historical Shadow receipts.

## Required fixtures

- Hyperliquid GTC, IOC, ALO, TWAP, partial fill, reject, cancel race, sequence gap,
  funding boundary, and adverse-selection cases.
- Arbitrum Uniswap quote expiry, block delay, route change, gas spike, slippage/revert,
  fee change, decimal mismatch, competing-flow and MEV stresses.
- Overfill, fill-after-cancel, wrong limit, duplicate retry, out-of-order events,
  missing costs, stale source, proxy-only input, and unknown queue.

## Metrics

- Deterministic canonical hash equality and lifecycle conservation failures.
- Assumption/cost completeness or `unscorable` rate by observability grade.
- Signed and absolute implementation-shortfall and total-cost residual.
- Fill-rate overstatement, partial/unfilled classification, Brier/calibration score for
  probabilistic fills, tail error, and pessimistic as well as optimistic bias.
- Compute/storage cost and p50/p95 simulation latency.

## Acceptance thresholds

| Gate | Threshold |
| --- | ---: |
| Deterministic replay/hash equality | 100% |
| Complete assumptions/costs or explicitly unscorable | 100% |
| Proxy inputs in promotable cohorts | 0 |
| Impossible fill, overfill, limit or terminal-state violation | 0 |
| Retry-created duplicate receipt | 0 |

A simulator cell is promotion-eligible only with at least 100 matched certified actual
executions in that exact venue × order/TIF × size bucket × predeclared regime, reported
effective sample, and a chronological holdout. The 95% confidence interval for MAE
improvement must exclude zero; signed optimism and tail gates cannot worsen. All state
completeness gates must pass. Otherwise the cell remains Shadow/evaluation-only.

## Promotion, demotion, and kill criteria

- Promote only the exact simulator/adapter/scenario/cell version through the existing
  outcome-calibrated promotion process.
- Demote on source-contract drift, completeness breach, bias/tail regression, sequence
  integrity loss, or reproducibility failure.
- Kill the feature if it influences venue, size, signer, permission, policy, authority,
  or dispatch; treats a quote/replay as a certified fill; hides unknown queue state;
  rewrites historical results; or cannot preserve idempotency.

All early verification is fixture, replay, local simulation, and Shadow. Provider
calls, deployments, funded tests, and live canaries require separate approval.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
