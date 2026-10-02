# Portfolio-Aware Sizing and Trade Construction

## Decision

**Implemented as a local synthetic Test Center fixture. Production use remains held
until authoritative portfolio and reconciliation state exists.**

The implemented slice is default-off, binds a same-operator Feature 09 fixture as
`requires_revalidation`, uses integer-only deterministic sizing, and produces only
inert constructions and synthetic fixture reservations. It does not alter the product
proposal lifecycle, routing, execution, signer, provider, venue, or customer mode.

Current proposal construction uses a small fixed cap and does not construct size from
the customer's complete portfolio, correlated exposure, liquidity, funding, or stress
loss. The later feature should turn a directional analytical intent into a bounded,
deterministic sizing decision and then map it into the existing `TradeProposal`.

## Target user and problem

Approval and Autopilot users need proposals whose combined portfolio risk is bounded,
not merely proposals that individually fit `maxOrderUsd` and `maxLeverage`.

## Why implement it

- Accounts for settled positions, pending orders, and concurrent reservations.
- Reduces or abstains when volatility, correlation, liquidity, funding, fees, margin,
  or data uncertainty make the trade unattractive.
- Makes every size, leverage, and construction constraint reproducible.
- Replaces generic fixed exits with policy- and market-aware construction where the
  venue supports certified protective orders.

## Why the mechanism should work

Volatility scaling, covariance shrinkage, stress testing, and transaction-cost-aware
allocation address known weaknesses in independent fixed-notional decisions. The
expected benefit is strongest for deterministic constraint enforcement; portfolio
performance remains an experiment question.

## Proposed benefit

| Hypothesis | Test target | Confidence |
| --- | --- | --- |
| Proposed trades violating aggregate exposure, correlation, margin, or liquidity limits | 40–70% relative reduction before preflight; released violations should approach zero | High for enforcement, low for the percentage |
| Modeled one-day stress loss at matched gross exposure | 15–35% reduction versus fixed notional | Medium-low |
| Reproducibility | 100% of sizing decisions bind policy and authoritative snapshot hashes | High |

Modeled stress loss is not actual customer loss. No PnL improvement is claimed.

## Dependencies

- [Authoritative risk snapshots](../authoritative-risk-snapshot-and-reconciliation/README.md)
  and atomic reservations are mandatory.
- Replay-grade aligned price histories, exact contract units, fee/funding inputs, and
  reconciled positions are required for the selected markets.
- The model may express direction, horizon, evidence, and calibrated uncertainty. It
  never sets executable size or leverage directly.

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
