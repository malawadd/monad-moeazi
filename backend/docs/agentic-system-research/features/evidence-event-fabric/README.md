# Evidence Event Fabric

## Decision

**Approved — 92/100 as one rollout unit of the event-driven evidence program.**

The current optional ingestor uses a fixed loop and the project explicitly identifies
material-event consumption as unfinished. The proposed fabric records evidence
immutably, evaluates quality/freshness/materiality deterministically, dispatches
idempotent Temporal analysis triggers, and preserves the exact replay manifest.

## Target user and problem

Every specialist and evaluator depends on timely, traceable evidence. Polling fixed
markets wastes work during quiet periods while still providing weak guarantees about
duplicates, corrections, late arrivals, trigger durability, and historical replay.

## Why implement it

- Gives every analytical input stable identity, lineage, revision, and time semantics.
- Reduces redundant analysis through dedupe, materiality, hysteresis, and coalescing.
- Measures freshness/quality per source family and role horizon.
- Makes every post-cutover analysis reproducible from an ordered manifest.
- Removes Redis from the role of durable trigger truth.

## Why the mechanism should work

Append-only event logs, transactional outboxes, idempotent consumers, provenance, and
pipeline SLOs are mature data-system patterns. Their value here is operational:
accepted evidence cannot silently disappear between storage and workflow dispatch, and
late/corrected data remains distinguishable from the original observation.

## Proposed benefit

| Hypothesis or invariant | Target | Confidence |
| --- | --- | --- |
| Analyses with complete replay manifest after cutover | 100% | High |
| Duplicate workflows for one trigger identity | Zero | High |
| Healthy-feed accepted-event to workflow-start SLO | At least 99% within the policy-specific target | Medium-high |
| Redundant quiet-market analyses/provider calls | Test 50–80% reduction versus fixed cadence | Medium-low |

The savings range is unvalidated, and a maximum-staleness cadence remains. No PnL
benefit or end-to-end exactly-once claim is made.

## Dependencies and boundaries

- Timescale is durable evidence and trigger-dispatch history.
- Redis holds hot pointers, short-lived dedupe/sequence state, coalescing, and locks.
- Temporal owns durable analysis workflows.
- Convex receives only current source/readiness summaries and product snapshots.
- Customer schedule synchronization is a separate feature:
  [Schedule Sync Outbox](../schedule-sync-outbox/README.md).

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
