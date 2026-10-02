# Validation — Cross-Layer Dependency Safety Envelope

## Matrix fixtures

Exercise every dependency class × scope × operation × state, including:

- stale/unknown policy, credits, signer, gateway, sidecar, venue, source, quorum and
  observability receipts;
- account-only, venue-only, partial-market, tenant and global outages;
- clock skew, TTL boundary, late/out-of-order receipts, flapping and duplicate events;
- restart with Redis loss but durable Convex/Timescale/Temporal state;
- uncertain submission while the submit lane is open, ensuring reconciliation remains;
- concurrent accounts where one incident cannot block unrelated tenants.

## Safety thresholds

| Gate | Threshold |
| --- | ---: |
| Covered boundary with fresh receipt-bound decision or fail-closed | 100% |
| Preflight/submit under a relevant blocking receipt | 0 |
| Reconciliation blocked solely by submit dependency outage | 0 |
| Half-open signing, broadcast, or external mutation | 0 |
| Authority/quorum/tier/policy relaxation | 0 |
| Duplicate incident/decision under retry | 0 |

The same unordered receipt set, matrix, operation, scope, and time must produce the
same canonical decision. More severe or broader relevant failure state must not
increase allowed operations. Unrelated scoped failure must not create a global block.

## Retry hypothesis

Establish a manual/current baseline using synthetic incident replays. Count futile
non-probe calls, allowed probes, successful recovery calls, latency, and time to stable
recovery by incident. Claim a percentage reduction only when a chronological held-out
comparison has a confidence-interval lower bound above zero and no safety regression.

## Kill criteria

Kill the feature if health can authorize work; the matrix globally blocks
reconciliation; a half-open probe mutates external state; one success clears a required
latch; Redis becomes durable truth; retries lose idempotency; recovery weakens quorum,
policy, tier, or customer mode; or a worker polls Convex.

Verification begins with fixtures, fake clocks/dependencies, local replay, and Shadow.
No live provider, wallet, venue, deployment, CI, or funded test is authorized.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
