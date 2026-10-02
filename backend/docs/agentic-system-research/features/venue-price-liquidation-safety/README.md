# Venue Price-Safety and Liquidation Receipt

## Current implementation status

Implemented and locally verified for checked-in synthetic fixtures in the isolated
Test Center. Product price authority, venue connectivity, signing, and execution
remain unavailable pending native owners, certification, revalidation, and separate
activation approval. The independent audit is archived privately for the later
roadmap remediation goal.

## Decision

**Approved as a venue-certification prerequisite — 95/100.**

Score: fit 14, evidence 12, safety 14, execution boundary 14, benefit 11,
evaluation 10, data 8, cost 6, latency 6.

## Target user and problem

Customers and operators need risk decisions to use the exact price semantics that a
venue uses for margin, triggers and liquidation. Current routing contracts expose
nullable scalar mark, index and oracle fields without formula revision, sequence or
account binding. Some public-routing adapters may conservatively substitute proxy
values; that is acceptable for labeled discovery but unsafe for execution margin.

## Why implement it

- Prevents a cross-venue mark, midpoint or public proxy from satisfying a native
  venue margin check.
- Makes oracle components, formula/config revision, freshness and disagreement
  explicit at every exposure-increasing boundary.
- Recomputes account-specific liquidation safety from authoritative positions,
  collateral, funding, fees and margin tiers.
- Keeps certified risk-reducing close and reconciliation available when an increase
  is blocked.

## Why the mechanism should work

Hyperliquid and GMX document distinct mark, oracle, trigger and liquidation rules.
Those rules and their observations can be encoded in reviewed adapters, compared to
recorded native fixtures and bound to an exact account snapshot. Deterministic policy
can then fail closed on missing or mismatched semantics. This does not prove an
oracle is honest or prevent a protocol-level liquidation.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Exposure increases with certified native semantics and account receipt | 100% | High |
| External marks, midpoints or routing proxies used as native margin inputs | Zero | High |
| Exact parity with certified native fixture calculations | 100% | High |
| False-eligibility defects caused by semantic mismatch | 50–90% reduction | Medium-low |

The percentage is a Shadow/evaluation hypothesis, not production proof or a PnL
claim. It applies only to defects attributable to price-semantic or liquidation-input
mismatch, not oracle manipulation or venue insolvency.

## Dependencies and boundaries

This dossier depends on authoritative risk/reconciliation, instrument identity,
certified venue adapters, native fixtures and the dependency safety envelope. EVM
venue state is bound to Arbitrum `42161`; Hyperliquid is a separate venue domain and
must never be mislabeled as chain `42161`. Models never calculate or choose margin
prices.

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
