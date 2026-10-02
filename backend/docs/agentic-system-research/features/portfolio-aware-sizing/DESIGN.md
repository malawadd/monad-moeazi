# Design — Portfolio-Aware Sizing and Trade Construction

## Authority boundary

The sizing engine is a pure deterministic domain component. It has no provider, wallet,
signing, or venue-credential imports. It consumes frozen typed inputs and returns a
typed decision. Execution still requires the existing proposal, approval/mode,
requote, policy, reservation, preflight, signing, and reconciliation gates.

## Proposed contracts

### `PortfolioSnapshot`

- account, chain, base currency, equity, cash, free collateral, liabilities;
- every spot/perpetual position with venue, instrument, side, quantity, delta/notional,
  mark, entry price, realized/unrealized PnL, margin mode, liquidation data;
- pending orders and reserved exposure/volume/position/credit capacity;
- current gross/net and cluster exposures;
- source revisions, observed time, expiry, quality, reconciliation status, and hash.

It must be derived from authoritative reconciled state. Missing positions, disputed
balances, or unresolved submissions invalidate the snapshot.

### `MarketRiskSnapshot`

- market/instrument/venue identity and contract units;
- aligned return history identifiers and sampling window;
- short/long realized volatility, stressed volatility, covariance/correlation matrix,
  estimator version, effective observations, and regime label;
- point-in-time exact depth/impact, liquidity haircut, funding curve, fees, gas,
  tick/min-notional, leverage/margin limits, price-gap scenarios;
- freshness, quality, source classification, expiry, and hash.

### `TradeIntent`

- market, direction, horizon, analysis/evidence/configuration hashes;
- calibrated probability/distribution when a validated calibration asset exists;
- invalidation conditions and allowed venues;
- no executable size, leverage, wallet instruction, or venue command.

Raw model confidence may only reduce size or cause abstention. Until calibration is
validated, it cannot increase size above the policy base risk amount.

### `SizingPolicy`

A versioned policy freezes:

- maximum order, market, correlated-cluster, venue, gross, and net exposure;
- leverage, collateral, liquidation-distance, daily loss, drawdown, and stress-loss
  ceilings;
- liquidity participation, impact, fee, funding, gas, and turnover ceilings;
- volatility/covariance windows, shrinkage estimator, stress multipliers, missing-data
  behavior, and minimum effective observations;
- confidence haircut, no-trade band, minimum net benefit, and abstention rules;
- protective-exit requirements and venue capability requirements.

Parameter values are selected through the dossier's replay protocol, frozen before a
subject runs, and activated as a policy version. They are not tuned on the held-out set.

### `SizingDecision`

- input/policy hashes, creation/expiry, requested base risk and approved risk;
- target and delta notional, leverage, order type constraints, and protective exits;
- modeled entry/exit fees, impact, funding, gas, turnover, margin, liquidation
  distance, and stressed loss;
- every binding constraint and applied haircut;
- `approve_for_routing | clamped | abstain` with deterministic reason codes.

## Deterministic algorithm

1. Validate freshness, reconciliation, units, history coverage, and policy versions.
2. Add settled positions, pending orders, and atomic reservations into aggregate
   exposure.
3. Estimate volatility and shrunk covariance using the frozen estimator; run frozen
   correlation-one, volatility, liquidity, funding, gap, and venue-outage stresses.
4. Compute remaining capacity under every hard ceiling.
5. Start from the smaller of policy base risk and volatility-targeted capacity.
6. Apply only downside confidence/evidence haircuts unless a calibrated forecast asset
   has separately passed promotion.
7. Subtract conservative round-trip fees, impact, funding-to-horizon, gas, and turnover.
8. Clamp against aggregate, cluster, venue, margin, liquidation, liquidity, and stress
   ceilings.
9. If data is incomplete, net benefit is below the hurdle, or no positive feasible size
   remains, return `abstain`.
10. Convert the approved delta into the existing `TradeProposal`; do not create another
    proposal lifecycle.
11. Recompute after any quote, position, reservation, policy, or evidence-freshness
    change.

## Construction rules

- Exact contract multipliers, decimals, tick size, and minimum notional come from the
  certified adapter.
- Protective exits use the frozen policy's risk budget and stressed volatility, then
  are clamped to venue capabilities and policy limits.
- A venue that cannot provide the required certified exit behavior is ineligible when
  policy requires it.
- Size is rounded down. Rounding up to satisfy a minimum is forbidden.
- A proxy depth input may inform Shadow comparison but cannot approve live size.

## Storage and monitoring

- Timescale stores full snapshots, decisions, scenarios, and predicted-versus-realized
  costs/outcomes.
- Convex stores the current proposal summary, approved size, binding constraints, and
  human-readable abstention reason.
- Redis owns the atomic in-flight reservation.

## Failure behavior

- Missing/stale/reconciliation-drift input: abstain.
- Singular or under-sampled covariance: use the frozen conservative fallback only if
  explicitly allowed; otherwise abstain.
- New asset without history: hard caps plus no correlated-risk optimization; default is
  abstain for Autopilot.
- Optimizer infeasible/non-convergent: abstain, never fixed-size fallback.
- Concurrent change: invalidate and recompute after reservation.
- Emergency stop: block regardless of a valid sizing decision.

## Later implementation sequence

1. Complete authoritative portfolio snapshots and reservation primitives.
2. Add typed contracts, units, and deterministic fixture calculations.
3. Add replay-only engine and compare with current fixed-notional proposals.
4. Add Shadow decisions and predicted-versus-realized cost/stress capture.
5. Promote only bounded parameters that pass validation.
6. Integrate Approval dry runs; Autopilot/live remains separately gated.

Rollback restores fixed small proposal sizing only in modes where existing policy
already permits it; unresolved reservations and proposals must first drain safely.

## Folded proposal-coherence extension

Enrich the existing `TradeIntent`; do not add another proposal lifecycle. Bind strategy
account, chain `42161`, canonical instrument, direction, requested delta, horizon and
validity window, risk cluster, evidence/policy/risk/sizing revisions, lifecycle state,
expiry, and canonical hash.

A pure `CoherenceDecision` returns `keep | hold | supersede | net_candidate | abstain`.
Exact same-revision duplicates collapse. Disjoint horizons coexist. Opposing overlap
holds and reruns this sizing engine; `net_candidate` is never executable. Supersession
is limited to explicitly safe unapproved/non-executing states and atomically expires a
pending approval packet. Approved, executing, submitted, or uncertain work cannot be
cancelled or rewritten. Scope is one strategy account; cross-account/tenant comparison
is forbidden.

Evaluate inside proposal creation and again immediately before exposure reservation.
Every reservation binds a fresh decision and exact revisions; drift holds/recomputes.
