# Evidence — Schedule Sync Outbox

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Database state and external event/side effect can diverge without an outbox | AWS source S27 | Production architecture guidance |
| Consumers must tolerate duplicates and preserve order/revision | AWS and Kafka sources S27/S28 | Production architecture/system documentation |
| Convex mutation writes and `runAfter` scheduling commit atomically | Convex source S34 | Official product documentation |
| Unimoazi identifies transactional schedule sync as unfinished and gives Temporal schedule ownership | Sources U01, U02, and U04 | Direct project architecture evidence |

## Evidence boundaries

- Scheduled external actions can fail and require explicit acknowledgement/retry.
- Exactly-once external Temporal effects are not assumed; deterministic IDs and
  desired-state reconciliation provide effective idempotency.
- The pattern does not establish how often current schedule drift occurs; baseline
  instrumentation must measure it.

## Counterevidence and limitations

- Outbox rows and retry state increase Convex writes.
- Very noisy/non-material profile patches could create needless commands unless
  desired-state hashing suppresses them.
- A successful Temporal call followed by lost acknowledgement requires read-back
  reconciliation, not blind recreation.
- Manual Guard and profile pause are separate controls and can race unless revisioned.

## Evidence freshness

Convex and Unimoazi documentation were checked on 2026-08-05. Revalidate Convex
scheduler guarantees and the current schedule-sync implementation before coding.
