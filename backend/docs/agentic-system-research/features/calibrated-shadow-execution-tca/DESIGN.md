# Design — Calibrated Shadow Execution and TCA Fidelity

## Ownership and placement

Extend one execution-quality/TCA domain alongside the existing router. The router
freezes a feasible route; the pure simulator evaluates that route's counterfactual
execution. It is not a second router or a model tool.

- Timescale: snapshots, requests, simulated fills, residuals, scorecards, corrections.
- Convex: current customer-safe `indicative | calibrated | unscorable` summary.
- Redis: short-lived market cache and sequence-gap coordination only.
- Temporal: delayed cancel/expiry/marking and later receipt matching.

## Proposed contracts

`ShadowExecutionRequest` binds proposal, sizing and route receipt hashes; account,
venue, chain context, canonical market, side, size, order type/TIF/limit; decision and
arrival times; quote/book/block references; scenario version; simulator/adapter
versions; seed; and a stable idempotency key.

`MicrostructureSnapshot` contains capture/event time, sequence range/completeness,
observability grade, book or AMM route/state reference, token decimals, fee/rebate,
funding, gas, margin and freshness schedules. Missing and not-applicable are distinct.

`SimulationScenarioSpec` is pre-registered deterministic code/config for base,
conservative, and severe assumptions. A model cannot create or select it.

`ShadowExecutionReceipt` contains the canonical input hash, scenario and seed, state
transitions, `SimulatedFill[]`, filled/residual quantity, probability/range where
applicable, `CostBreakdown`, assumption flags, confidence class, terminal status, and
receipt hash.

`TcaResidual` links one immutable Shadow receipt to one later certified reconciliation
receipt and decomposes price, fill, fee, funding, gas, timing, reject, cancel, and tail
error. `SimulatorCalibrationDecision` is deterministic and versioned.

## State and conservation rules

Allowed states are `accepted`, `rejected`, `resting`, `partially_filled`, `filled`,
`cancel_pending`, `cancelled`, `expired`, and `unknown`. Every transition checks:

- sum of fills plus residual equals requested quantity;
- limit price and TIF semantics;
- no fill after a terminal state;
- cancel races, gaps, and delayed observations cannot become successful fills;
- corrections append a superseding record and never rewrite history.

## Venue semantics

### CLOB and perpetuals

Market/IOC walks observed depth after modeled latency and cancels any remainder.
GTC/ALO uses a queue interval or fill-probability range and adverse-selection stress.
Unknown queue is explicit, never front-of-queue. Funding, margin, liquidation context,
cancel races, rebates, and partial outcomes are separate fields.

### Arbitrum AMM

Bind exact quote/route, chain `42161`, block/state, path/token units, gas estimate,
deadline/slippage, and simulation result. Stress block delay, competing state/MEV,
gas, route change, and revert. Do not apply a CLOB queue model.

## Cost breakdown

Record entry and exit fee/rebate, impact/slippage, funding-to-horizon, gas, applicable
setup/transfer cost, liquidation/exit stress, and partial/unfilled opportunity
treatment. Missing never becomes zero. Reuse the existing routing math/vocabulary so
routing, sizing, and TCA cannot disagree silently.

## Failure and retry behavior

- Missing calibration: conservative/severe or `unscorable`, never optimistic default.
- Sequence gap/stale state: downgrade observability or stop scoring.
- Retry: key by proposal + route + simulator + scenario + attempt; return the same
  receipt rather than creating another fill history.
- Actual submission uncertainty remains owned by reconciliation; the simulator never
  guesses or triggers a rebroadcast.

## Cost, latency, rollout, rollback

Local simulation adds bounded compute and storage; depth replay may add seconds and
retention cost. Preview exact maximum cases and retention before Evaluation runs.
Rollout: contracts/fixtures, current-baseline comparison, Shadow summaries, matched
residual capture, then cell-specific promotion. Rollback stops new simulations and
preserves immutable receipts; it does not alter routes or real executions.
