# Authoritative Risk Snapshot and Reconciliation Receipt

## Decision

**Approved — 91/100. Highest implementation priority.**

Implementation status: **Implemented locally; product unavailable.** The checked-in
synthetic corpus is available only in the isolated Test Center. Detailed review
material is archived privately for the later roadmap remediation goal.

The current execution policy names the right checks, but the execution workflow
constructs daily volume, exposure, loss, drawdown, position count, and credits-spent
with zero placeholders. Provider quorum, venue health, and reconciliation also begin
as optimistic booleans. A policy object is not a safety control when its inputs are
not authoritative.

## Target user and problem

This protects every customer using Approval or Autopilot and every operator debugging
an uncertain order. It prevents a valid-looking proposal from passing policy because
required state was missing, stale, or concurrently consumed by another proposal.

## Why implement it

- It closes a demonstrated production-boundary gap rather than adding speculative
  analysis capability.
- It turns each policy decision into a reproducible statement about exact account,
  credit, venue, evidence, quote, and reconciliation state.
- Atomic reservations prevent two individually valid proposals from jointly exceeding
  an exposure, volume, position, or credit ceiling.
- Submission receipts make timeout and uncertain-broadcast recovery deterministic.

## Why the mechanism should work

The mechanism applies established transaction-safety principles: read authoritative
state, reserve scarce capacity atomically, bind the state and quote into the decision,
submit once under an idempotency key, and reconcile before releasing the reservation.
External intent/gateway and lifecycle systems support the separation pattern, but the
proposal deliberately retains Unimoazi's existing contracts and services.

## Proposed benefit

| Benefit | Target | Confidence |
| --- | --- | --- |
| Policy-input completeness | 100% of execution decisions name an authoritative value, source revision, and freshness result for every required input | High |
| Lifecycle traceability | 100% of transitions have a receipt or explicit failed-receipt record | High |
| Placeholder policy passes | Zero | High |
| Concurrent limit oversubscription | Zero in deterministic concurrency tests | High |
| Uncertain-submission recovery | Every injected timeout resolves without blind rebroadcast | Medium-high |

No PnL improvement is claimed. The expected value is avoided loss, bounded authority,
and faster incident reconstruction. A monetary projection requires real incident and
near-miss data that Unimoazi does not yet have.

## Dependencies and boundaries

- Retain `TradeProposal`, `ExecutionDecision`, the Temporal execution workflow,
  Convex proposal state, the gateway/sidecar boundary, and existing idempotency keys.
- Use Convex for current account and product state, Redis for atomic reservations and
  circuit breakers, Timescale for detailed immutable receipts, and Temporal for
  durable reconciliation.
- Never expose snapshot data that contains secrets, signing material, hidden model
  reasoning, or raw credentials.
- Live execution remains certification-gated.

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
