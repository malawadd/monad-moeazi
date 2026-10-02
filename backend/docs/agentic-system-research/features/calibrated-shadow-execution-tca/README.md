# Calibrated Shadow Execution and TCA Fidelity

## Decision

**Approved for bounded Shadow and evaluation design — 88/100.** Promotion of any
simulator cell requires a large cohort of certified, matched actual executions.

Score: fit 14, evidence 8, safety 14, execution boundary 14, benefit 9,
evaluation 10, data 4, cost 8, latency 7.

## Target user and problem

Operators and customers need Shadow results that distinguish a quote from a fill. The
current path records one current quote from the first candidate venue as a complete
entry fill. It omits latency, partial or unfilled states, queue uncertainty, fees,
funding, gas, exit costs, adverse selection, and cancel races.

## Why implement it

- Prevents paper fills from appearing more executable than their evidence supports.
- Makes CLOB/perpetual and Arbitrum AMM semantics explicit instead of sharing one
  optimistic fill rule.
- Produces immutable cost and lifecycle receipts that later actual fills can calibrate.
- Gives portfolio sizing, outcome evaluation, and promotion a defensible execution
  label without moving any signer or execution tool into the model plane.

## Why the mechanism should work

Official venue documentation defines order/TIF, partial-fill, cancellation, quote,
route, gas, deadline, and simulation boundaries. Queue research shows that passive
fill value depends on position that a book snapshot often cannot reveal. A versioned,
deterministic simulator can therefore reproduce observable mechanics, expose unknowns,
and measure its residual against certified receipts. It cannot recreate hidden flow or
prove live execution from a quote.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Assumption and cost-field coverage | 100% complete or explicitly `unscorable` | High |
| Optimistic signed cost/fill error versus current baseline | 30–60% relative reduction | Medium-low |
| Absolute total-cost error in a qualified simulator cell | 20–40% relative reduction | Low |
| Impossible fill, overfill, or fill after terminal state | Zero in property fixtures | High |

Percentages are hypotheses, not production evidence or PnL claims. The error target
assumes time-aligned state and at least 100 effective matched executions in each exact
venue × order/TIF × size-bucket × regime cell; this may require thousands of fills.

## Dependencies and boundaries

- Consume, never replace, authoritative risk/reconciliation, portfolio sizing, and
  the existing execution-quality route plan and cost vocabulary.
- EVM activity remains Arbitrum `42161`; a permitted Hyperliquid account is a separate
  subordinate venue context, not chain `42161`.
- The engine never selects venue, size, scenario, policy, authority, or signer and
  never submits or cancels an order.
- Particle and Magic remain owner signers. Quotes, simulations, prepared transactions,
  and receipts are not authority.

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
