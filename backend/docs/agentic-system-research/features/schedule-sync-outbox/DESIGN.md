# Design — Schedule Sync Outbox

## Material changes

Create a command only when the canonical desired schedule hash changes because of:

- profile activation/deactivation or lifecycle change;
- cadence or watched-market subscription change;
- profile pause/resume;
- strategy-account ownership/lifecycle change that affects scheduling;
- Manual Guard transition when schedule pause/resume is part of the selected runtime
  behavior.

Cosmetic names and unrelated fields do not enqueue a command.

## `ScheduleSyncCommand`

Required fields:

- command ID and idempotency key `schedule-sync:{profileId}:{revision}`;
- profile, strategy account, schedule revision, previous revision;
- complete desired-state hash and bounded desired markets/cadences;
- lifecycle, pause, Manual Guard/effective scheduling state;
- status: `pending | dispatching | retry_wait | acknowledged | superseded |
  dead_letter`;
- attempt count, next retry time, created/updated/acknowledged times;
- Temporal result revision/hash, error code/summary, and operator acknowledgement when
  dead-lettered;
- scheduled-function IDs for immediate dispatch and watchdog.

Never store browser authentication subjects, secrets, or service credentials in the
command.

## Atomic creation

The existing authenticated Convex mutation that commits the material profile or
subscription change must, in the same transaction:

1. increment the schedule revision;
2. calculate canonical complete desired schedule state;
3. suppress a command when its hash is unchanged;
4. insert the outbox command;
5. schedule an internal dispatch action with `runAfter(0, ...)`;
6. schedule a watchdog mutation for the attempt timeout.

If the mutation fails, neither the product change, command, nor scheduled work commits.

## Dispatch and acknowledgement

1. An internal mutation claims the latest non-superseded revision and marks it
   `dispatching`; older pending commands become `superseded`.
2. The internal action calls the authenticated Agent API with the complete desired
   state and idempotency key.
3. The API asks Temporal to reconcile all schedules for the profile revision:
   create/update desired markets, remove obsolete markets, and apply pause state.
4. Temporal schedule/workflow IDs use profile/market identity and the revision is stored
   in schedule metadata.
5. The API reads back the resulting schedule set and returns its canonical hash.
6. A Convex mutation acknowledges only when revision and actual hash match the command.
7. On failure, a mutation records a bounded error and atomically schedules the next
   retry with exponential backoff and jitter.

Scheduled actions are treated as at-most-once attempts. The durable command and
watchdog—not action retry assumptions—provide recovery.

## Watchdog and dead letter

The watchdog mutation checks only its command ID:

- acknowledged/superseded: no action;
- pending/retry due: schedule a new internal action;
- dispatching beyond lease: return to retry with the same idempotency key;
- attempts exhausted or permanent validation failure: mark `dead_letter` and create
  one material operator event.

This is targeted scheduled work, not a worker polling Convex for jobs.

## Revision and removal rules

- Temporal rejects a revision older than its recorded profile revision.
- The command contains complete desired state, not only additions.
- Reconciliation enumerates schedules under the deterministic profile prefix and
  deletes/pauses every market not in desired state.
- If Temporal succeeded but acknowledgement was lost, read-back returns the matching
  state and the retry acknowledges without duplicating schedules.
- Manual Guard missing state fails safe; automatic schedules remain paused until the
  authoritative control is available.

## Current-state projection

Convex exposes a bounded schedule sync summary:

- desired revision/hash;
- acknowledged revision/hash;
- pending/failed status and last meaningful error;
- count of desired versus actual schedules;
- last reconciliation time.

Do not write per-heartbeat success events into product tables.

## Failure, cost, and latency behavior

- Command validation failure becomes a bounded permanent error and dead letter; it
  never calls Temporal.
- Transient Convex action, network, Agent API, or Temporal failures retry the same
  command/idempotency key under the watchdog policy.
- A newer revision supersedes older pending work but does not erase its audit state.
- Command rows, scheduled functions, and current summaries must be measured against a
  per-profile Convex IO budget; unchanged desired-state hashes produce no command.
- Track save-to-command, command-to-dispatch, dispatch-to-Temporal-ack, and end-to-end
  reconciliation latency. The later implementation must freeze an operator SLO before
  activation and surface breaches without continuous heartbeat writes.

## Later implementation sequence

1. Add command schema/indexes and canonical desired-state hash fixtures.
2. Insert commands atomically in profile/subscription lifecycle mutations.
3. Add internal dispatch/ack/watchdog with a fake Temporal service.
4. Implement complete desired-state reconciliation and obsolete schedule removal.
5. Backfill one command for each active profile and reconcile in Manual Guard mode.
6. Remove browser/API dual-write dependence after observed parity.

Rollback stops new dispatch actions but preserves commands and existing Temporal
schedules. Operators reconcile pending/dead-letter commands before removing schema.
