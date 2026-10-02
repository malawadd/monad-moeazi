# Productionized Multi-Venue Execution-Quality Routing

## Decision

**Approved as a narrowed extension — 85/100.**

Unimoazi already has a read-oriented router that checks feasibility and compares
entry/exit fees, round-trip depth impact, and horizon funding. The approved feature is
to productionize that single router with exact/account-specific inputs, immutable route
plans, execution integration, and reconciliation. Building a second router is rejected.

## Target user and problem

Customers need an executable venue choice for their exact side, size, account, and
horizon. A cheapest displayed or public route is not necessarily account-ready,
certified, fresh, sufficiently deep, or reconcilable.

## Why implement it

- Reuses the current router instead of leaving execution to the proposal's first venue.
- Makes exclusions and all-in cost components inspectable.
- Prevents proxy/indicative data from becoming an execution claim.
- Binds the chosen route to fresh preflight and later realized execution evidence.
- Provides venue-health and adapter-quality feedback without model authority.

## Why the mechanism should work

Feasibility-first routing removes unsafe candidates before comparing normalized
economic cost. Fresh re-routing and receipt binding prevent stale plans from surviving
position, policy, quote, fee, or venue changes. Reconciled outcomes make the router's
estimates measurable rather than self-reported.

## Proposed benefit

| Benefit | Target | Confidence |
| --- | --- | --- |
| Route lifecycle traceability | 100% of transitions have a receipt or explicit failed receipt | High |
| Proxy/indicative inputs in executable selection | Zero | High |
| Stale, sequence-gapped, or insufficient-depth candidates selected | Zero in deterministic tests | High |
| Modeled all-in execution cost | Test 15–35% improvement versus the current all-in router; no claim until paired evidence exists | Low |
| Quote/preflight mismatch attempts | Measure separately; researched 25–50% range remains unvalidated | Medium-low |

Actual execution-cost improvement requires certified, reconciled fills and is not
claimed by this dossier.

## Dependencies

- [Authoritative risk snapshots and receipts](../authoritative-risk-snapshot-and-reconciliation/README.md).
- [Portfolio-aware sizing](../portfolio-aware-sizing/README.md) for the exact executable
  side and size.
- Certified venue adapters and account-specific fee/collateral/readiness data.
- Exact or exact-public data; current proxy inputs remain Shadow/display only.

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
