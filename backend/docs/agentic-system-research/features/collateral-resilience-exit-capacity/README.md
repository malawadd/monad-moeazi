# Collateral Resilience and Exit-Capacity Envelope

## Implementation status

Implemented and implementation-verified for local synthetic Test Center use. The
independent audit is archived privately; product activation and external side effects
remain unavailable pending the documented native-data and validation gates.

## Decision

**Approved as a portfolio-risk input — 93/100.**

Score: fit 14, evidence 10, safety 14, execution boundary 14, benefit 10,
evaluation 10, data 7, cost 7, latency 7.

## Problem and target user

Customers and operators need to know whether collateral retains stressed usable
value and whether positions/collateral can practically be closed, settled and
withdrawn. Venue-native liquidation distance answers a different question and a
displayed midpoint cannot prove exit capacity.

## Why implement it

- Maps issuer, bridge, wrapper, custodian and venue dependencies per exact asset.
- Applies versioned depeg, outage, haircut, delay and concentration scenarios.
- Measures executable close, settlement and withdrawal capacity separately.
- Blocks new exposure on unknown or inadequate coverage while preserving a certified
  reduce-only path.

## Why it should work

Venue balances, executable depth, withdrawal mechanisms and dependency state are
observable enough to stress with deterministic policy. Comparing stressed usable
collateral and executable close capacity against native maintenance requirements can
identify candidates that a nominal balance misses. It cannot prove issuer solvency,
continuous liquidity or timely withdrawal.

## Benefit, confidence and assumptions

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| New exposure with complete asset/dependency/exit evidence | 100% | High |
| Missing state interpreted as healthy collateral | Zero | High |
| Stressed maximum loss in modeled scenarios | 20–60% reduction | Low |
| Certified close/reconcile preserved during degradation | 100% required cases | High |

The percentage is a scenario-model hypothesis, not a production forecast or PnL
claim. Haircuts may reduce capital efficiency and must be assessed alongside false
blocks.

## Boundaries and dependencies

The envelope is nested into authoritative risk, sizing and preflight. It is not a
venue solvency score, router, liquidation calculator or authority to bridge, swap,
withdraw or liquidate. EVM asset identity remains Arbitrum `42161`; non-EVM venue
domains are explicit.

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
