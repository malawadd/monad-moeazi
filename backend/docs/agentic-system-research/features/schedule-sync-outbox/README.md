# Schedule Sync Outbox

## Decision

**Approved as a separate rollout dossier under the 92/100 event-driven evidence
program.**

## Local implementation status

Feature 26 is implemented only as a default-off, synthetic Test Center proof. It
does not change the existing Convex/Temporal scheduling path, start schedules, or
grant runtime authority. Product activation remains unavailable pending the owners
and validation described below. Its implementation audit is archived privately and
remediation is deferred to the roadmap audit goal.

Agent profile, subscription, lifecycle, cadence, and pause changes are canonical in
Convex, while Temporal owns durable schedules. A UI/API call that saves Convex state
and separately calls Temporal can fail between those operations. The outbox makes the
desired schedule revision durable and retryable without polling Convex for jobs.

## Target user and problem

Customers need saved agent settings to produce exactly the intended schedules. A
partial sync can leave removed markets running, new markets absent, or an old cadence
overwriting a newer one.

## Why implement it

- Atomically couples each material Convex configuration change to a sync command.
- Makes Temporal updates idempotent and revision-ordered.
- Reconciles additions, changes, removals, pauses, and Manual Guard effects.
- Exposes durable pending/retry/dead-letter state without heartbeat noise.
- Removes correctness dependence on the browser completing a second request.

## Why the mechanism should work

Transactional outbox and idempotent consumer patterns directly address database/event
dual writes. Convex can atomically create an outbox row and schedule internal work from
the same mutation; Temporal applies a complete desired state under a deterministic
revision key.

## Proposed benefit

| Invariant | Target | Confidence |
| --- | --- | --- |
| Committed material profile revisions with durable sync command | 100% |
| Stale revision overwriting newer schedule state | Zero |
| Obsolete market schedules after acknowledged reconciliation | Zero |
| Duplicate external calls creating duplicate schedules | Zero |
| Unexplained terminal sync failures | Zero; every terminal failure is operator-visible |

No trading or PnL benefit is claimed. The value is configuration correctness and
recoverability.

## Boundaries

- Convex remains the desired product-state owner.
- Temporal remains the actual schedule owner.
- The outbox is not a general job queue and does not dispatch analysis work.
- Market evidence triggers belong to the
  [Evidence Event Fabric](../evidence-event-fabric/README.md).
- No long-running worker polls Convex.

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
