# Canonical Instrument Lifecycle Registry and Event Gate

## Decision

**Approved as the first Cycle-12 implementation-review priority — 95/100.**

## Local implementation status

Implemented locally in the isolated Test Center. Product catalog, routing, venue
metadata, signing and live execution remain unavailable pending separate approval.

Score: fit 14, evidence 11, safety 14, boundary 14, benefit 10, evaluation 10,
data 8, cost 7, latency 7.

## Problem and causal argument

String normalization and positional venue indices can collapse distinct spot, perp,
settlement, namespace or environment identities and cannot represent delisting or
terms changes. Immutable native identity/definition versions plus explicit lifecycle
events prevent stale symbol/index mappings from authorizing new exposure.

## Why implement it

- Binds every route, proposal, position, execution and journal entry to one exact
  instrument definition version.
- Separates display aliases from identity and reviewed economic continuity.
- Invalidates affected artifacts on halt, delisting, expiry or material terms change.
- Preserves venue-certified cancel/reduce/settle/reconcile behavior.

## Benefit and confidence

| Target | Invariant | Confidence |
| --- | --- | --- |
| Trading artifacts referencing exact registry version | 100% | High |
| Symbol-only/environment-free identity passing | Zero | High |
| Unreviewed continuity transforms | Zero | High |
| Seeded lifecycle/mapping mutations invalidated | 100% required corpus | High |

No universal symbology, all-wrong-market prevention or PnL claim is made.

## Boundaries

The registry owns economic identity, definition and lifecycle—not adapter code,
routing, custody postings or reconciliation. Evidence Fabric transports native events;
models may summarize but never infer a transform or authorize migration.

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
