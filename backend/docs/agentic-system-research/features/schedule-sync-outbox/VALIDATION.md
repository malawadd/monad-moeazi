# Validation — Schedule Sync Outbox

## Transaction tests

- Product mutation, revision, command, immediate action, and watchdog all commit or all
  roll back.
- Non-material patches do not create commands.
- Concurrent mutations produce ordered revisions and one canonical latest desired
  state.
- Required profile fields survive partial patches.

## Delivery tests

- Duplicate, reordered, delayed, and superseded commands.
- Temporal outage, timeout before/after update, and successful update with lost
  acknowledgement.
- Convex action crash before claim, after claim, after API response, and before ack.
- Watchdog recovery and bounded retry/dead-letter behavior.
- Stale revision cannot overwrite newer Temporal metadata.

## Schedule reconciliation tests

- Add, change cadence, pause, resume, deactivate, and delete a market subscription.
- Partial market sync and removed-market cleanup.
- Manual Guard on/off and missing control state.
- Exact desired/actual hash with deterministic schedule IDs.
- No duplicate schedules after every retry/failure permutation.

## Metrics and acceptance thresholds

| Metric | Threshold |
| --- | --- |
| Material committed revisions with command | 100% |
| Acknowledged commands whose actual hash differs | 0 |
| Stale revision overwrites | 0 |
| Duplicate schedules from retries | 0 |
| Obsolete schedules after acknowledgement | 0 |
| Terminal failures without dead-letter/operator state | 0 |
| Idle worker Convex job polling | 0 |

Measure command volume and Convex IO against the current save/sync path. Add desired
state hashing or batching if command noise is material, without weakening correctness.

## Kill criteria

- Profile save can succeed without a durable command when desired state changed.
- Browser completion remains required for correctness.
- Retry creates duplicate schedules or revives deleted markets.
- A stale command changes Temporal state.
- Authentication subject or service secret is persisted in a command.
- Reconciliation relies on an unbounded Convex scan or polling worker.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
