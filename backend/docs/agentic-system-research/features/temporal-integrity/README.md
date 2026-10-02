# Temporal Integrity and Causal Sequencing Envelope

## Decision

**Approved as an execution/control-boundary prerequisite — 94/100.**

**Implementation status:** Implemented locally. Product availability remains
unavailable; the isolated Test Center is the only executable surface.

Score: fit 14, evidence 10, safety 14, boundary 13, benefit 10, evaluation 10,
data 8, cost 8, latency 7.

## Problem and causal argument

Independent process wall clocks currently drive freshness, approval expiry, budget
epochs, deadlines and some venue nonces. Explicit clock domains, uncertainty intervals
and signer-scoped nonce leases prevent ambiguous time or concurrency from silently
becoming valid. This is not a global clock or generic event timestamp service.

## Why implement it

- Treats quote, approval, budget, chain, venue sequence and nonce domains explicitly.
- Blocks ambiguous interval overlap, rollback/jump, sequence gaps and nonce conflicts.
- Separates idempotency from protocol-specific nonces.
- Preserves certified close/cancel/revoke/reconcile during degraded time state.

## Benefit and confidence

| Target | Invariant | Confidence |
| --- | --- | --- |
| Signing with fresh temporal decision and signer nonce lease | 100% | High |
| Duplicate or possibly-submitted nonce reuse | Zero | High |
| Wall-clock-only causal assertions | Zero | High |
| Seeded clock/nonce/sequence faults blocked | 100% required corpus | High |

No perfect-time, global-ordering, replay-prevention or incident-reduction claim is
made. Initial value is measured misclassification and duplicate-nonce prevention.

## Boundaries

Evidence Fabric owns source-event timestamps/watermarks; Temporal owns workflow
history; Dependency Safety consumes temporal health. Gateway/sidecar owns final nonce
allocation/sign enforcement. Models never see nonce tools.

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
