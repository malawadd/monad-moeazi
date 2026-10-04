# Agent Platform Runbook

## Instrument lifecycle fixture boundary

If Feature 07 is ambiguous, stale, disputed or rebaseline-required, leave it off
outside the isolated Test Center. Do not manually map symbols, migrate positions, or
bypass the fixture operation matrix.

## Development safe defaults

Open `/agent-lab` and verify Manual Guard and Lite Mode are ON. “Restore safe defaults” pauses
agent schedules, cancels queued automatic jobs, and restores Lite limits. If Redis is unavailable,
the API reports safe defaults; do not disable a safeguard until Redis health is restored.

## Production autonomous start

Disable development controls at deployment, synchronize every active profile schedule, and verify
schedule count matches enabled subscriptions. Keep `LIVE_EXECUTION_ENABLED=false` until all six
venue certifications exist. Watch dispatch latency, provider budget, credit reservations, snapshot
freshness, and reconciliation drift during rollout.

## Lite Mode budget exhausted

Keep Lite Mode on. Confirm Redis daily run and provider-microusd keys match Agent Lab. Do not reset
counters to continue testing; wait for the UTC boundary or deliberately raise the environment ceiling
with an operator audit record.

## Provider quorum failure

Pause autopilot for affected accounts, inspect provider-call status by analysis ID, and check
rate limits/timeouts. Focus requires four valid specialist outputs. Pro and Max require two
canonical model families, their minimum valid-output count, and every critical role. For OpenRouter,
inspect the served model, selected upstream host, fallback attempts, and missing routing metadata.
Invalid or failed calls
are operational cost and must not be settled against user credits.

## BYOK connection or budget failure

Open `/agents/models`, refresh the provider catalog, and run the compatibility probe. Rotation first
verifies the replacement key and only then revokes the previous credential. Revocation pauses any
agent whose active route depends on that connection. Never copy a credential into Convex or a
Temporal input while debugging. If the Redis daily provider-cost reservation is exhausted, keep the
run blocked until the UTC reset or an audited budget change; do not fall back to a platform key.

## Monitoring trace review

Use `/agents/monitoring` for account-scoped usage and open a run to inspect its evidence-to-action
graph. Technical details include structured inputs, outputs, usage, latency, and errors. Hidden model
reasoning is intentionally unavailable; investigate using the recorded decision summary, factors,
uncertainties, evidence IDs, and deterministic check results. Detailed nodes expire after seven days,
while aggregate usage remains available.

## Stale evidence or analysis

Check ingestor logs and Redis `evidence:hot:*` TTLs, then verify Timescale evidence timestamps.
Do not extend a snapshot expiry manually. Let a fresh workflow complete. Autopilot stays
blocked while critical evidence is stale or incomplete.

## Reconciliation drift

Open the account/venue circuit breaker, prevent new submissions, and compare venue orders,
fills, balances, and positions with proposal/execution audit records. Resolve or explicitly
write off the drift before closing the breaker. Retrying must reuse the original idempotency
key; never generate a new key for an uncertain submission.

## Evidence lifecycle boundary

Treat `unverifiable`, `public_onchain`, `partial`, held, and corrupt-tombstone states as
conservative blocks. Never edit a copy receipt, tombstone, command, hold revision, or
operation receipt. The expiry dispatcher polls only durable Timescale outboxes; it does
not poll Convex or providers. A Redis deletion failure stays retryable and bounded
exhaustion becomes `unverifiable`, never verified deletion.
The evidence cache key is always `evidence:hot:{MARKET}:{artifact_id}` from the shared
sanitized locator contract. A zero Redis delete count proves neither deletion nor
absence and must remain `unverifiable`. Copy commands, receipts, and aggregation are
bound to one retention schedule; never reuse evidence from an older schedule.

For hold expiry, confirm a transition is prepared before projection and acknowledged
only after the matching revision reaches Convex. An older expiry must not replace a
renewed hold or relax `deleted`, `quarantined`, or `unverifiable`. For restore checks,
any tombstone ID, column, payload, copy, artifact, or hash disagreement is quarantine.
Do not call provider deletion, Temporal retention/admin, backup administration, KMS,
or onchain mutation APIs from this runbook.

Run both `npm run evidence-sinks:check` and the Python lifecycle sink test after adding
any persistence, Redis, Temporal, provider, Convex, or lifecycle-facing response path.

## Dependency safety envelope

Open `/risk` or `/agents/monitoring` and identify the blocked operation, dependency,
scope, reason code, freshness, and abbreviated receipt/decision hash. Preserve the
block. Do not edit a projection, clear Redis to simulate recovery, extend a TTL, or
substitute an operator health boolean.

Confirm the authoritative owner emitted the receipt and that Timescale contains the
same canonical hash before inspecting the Convex projection. A Timescale/Convex write
failure blocks proposal, approval request, preflight, and submit. Redis loss prevents
recovery coordination but cannot resolve the incident. Restore Redis, then provide
two fresh healthy owner observations separated by the registry recovery interval.
Any failure restarts recovery.
Do not infer recovery from time passage or a healthy local receipt. Confirm the second
distinct owner receipt and the durable Convex incident projection are both `resolved`.

Reconciliation uses its own read lane and must remain available during a submit-only
outage. Recovery work may read and reconcile; it may not sign, broadcast, mutate a
venue, change customer mode, or relax policy/quorum. Rollback sets
`DEPENDENCY_SAFETY_MODE=observe`, preserves all history/incidents, and leaves existing
conservative gates in place. Never enable live execution during an observe rollback.

### Isolated Dependency Test Center

`/agent-lab/test-center` is not the product control plane. If it is unavailable, first
confirm the explicit local/test environment, Particle operator allowlist, loopback
bind, frozen repository SHA, closed live/setup gates, empty certifications, and
external-network-off setting. Do not route it through `/api/agent-backend`.
The backend is the dedicated `test-center` Compose profile at host-loopback port 8110;
the main API does not mount these routes. The legacy `/agent-lab` root is page-level
disabled until it has its own authenticated, operator-allowlisted transport.
The Test Center container has an independent minimal environment and joins only the
internal network shared with Timescale and Redis. Run migration 008 for legacy run
idempotency fields; its fixture test reruns the migration after upgrading an existing row.

Feature 02 controls are separate from Feature 01 at
`moeazi:test-center:controls:v2:{operatorTestId}:{featureId}`. Enable Feature 01 through
project before Feature 02 observe, or through enforce before Feature 02 isolated
enforce. Migration 009 backfills old rows to Feature 01 and adds immutable recovery
artifacts/transitions. A recovery pass is inspection-only: it cannot copy data to
production, call an external system, or change product recovery from `UNKNOWN`.

For rollback, set Feature 02 off, preserve its Timescale evidence, keep Feature 01 in
observe and leave Manual Guard, Lite Mode, setup, certification and live gates closed.
Do not claim a production RPO/RTO from the local fixture measurements.

Feature 03 uses the same feature-scoped lease and Feature 01 prerequisite closure.
Its observe and enforce modes are synthetic Test Center capabilities only. Confirm the
UI says `Isolated Test Center only — audit findings deferred`, verify the frozen audit
trace/hash and severity counts, and never interpret a passing fixture as product
activation or a resolved audit finding.

Feature 04 requires the sorted closure of Features 01, 02 and 03. Observe freezes all
three through project; isolated enforce freezes all three through enforce in one CAS
snapshot. Run only checked-in fake-vault fixtures. A local pass never enables product
custody, reads a real legacy row, verifies upstream revoke, or authorizes signing.
Rollback sets only Feature 04 off, discards in-memory fake-vault state, preserves
immutable metadata receipts, and leaves quarantined capabilities disabled.

An operator may lease observe or isolated enforce controls for at most two hours.
Manual Guard and Lite Mode are immutable ON ceilings. A Redis error or missing lease
means off. Run only a checked-in scenario ID. Timescale must contain the frozen run,
control change and ordered events; do not reconstruct or edit history. A sanitizer,
hash, CAS, sequence, authorization, origin, or persistence failure aborts the run.

### Evidence lifecycle incident

If governed evidence or a projection is blocked, inspect the stable lifecycle reason,
abbreviated decision hash, producer, sink, scope and policy version. Never paste the
rejected body into logs or traces. Confirm the immutable Timescale decision exists
before inspecting Convex; projection failure keeps the artifact incomplete.

For expiry, verify the registry schedule and any current bounded hold. Temporal waits
on the durable due-time and owner receipt signals; it must not poll Convex or call a
provider. Missing, partial, provider-reported, unverifiable, or public-chain copies
remain unresolved. Never manually promote them to verified or claim onchain erasure.
Schedule-null legacy copy receipts stay in separate immutable quarantine history and
must never be rebound to a newer schedule. Before returning a trace or export, verify
the current body expiry/deletion state and latest copy dispositions; an older access
receipt never overrides a later hold, quarantine, partial disposition, erasure, or expiry.
The monitoring run collection must validate every returned analysis ID in the caller's
account scope before returning any member; do not substitute the synthetic collection
identifier for those checks. Investigate duplicate artifact IDs with the canonical
`scope_key`. Never remove the scope predicate from schedules, owner commands, holds,
tombstones, receipts, Evaluation idempotency, or destructive body updates.

If restored data intersects a tombstone, stale policy, unknown copy inventory or wrong
scope, keep it quarantined and unavailable to product projection, Redis, monitoring,
providers, proposals and execution evidence. Rollback freezes the registry and stops
new lifecycle workflows while preserving hard secret blocks, tombstones, holds and
receipts. Do not restore removed bodies or classify legacy rows as governed.

## Credit reservation stuck

Find the analysis job and Temporal workflow. If the workflow is active, restore its worker.
If it is terminal without a validated synthesis, fail the job and release the full reservation.
Settle only validated successful specialist/synthesis outputs and refund the remainder.

## Manual Guard race

## Execution artifact certification

Feature 05 is an isolated local Test Center capability. Keep its lease off unless an
operator is running a checked-in fixture. A blocked artifact result preserves local
history and does not change product, venue, signer, or setup state. Rollback sets
only the Feature 05 lease off; never clear a drift latch or requalification record
manually. Any live validation remains a separately approved activity.

Turning Manual Guard on pauses schedules and cancels queued automatic Convex jobs. A workflow already
inside a provider call stops at the next safe checkpoint; do not terminate an activity that may be
reconciling state. Explicit manual runs remain allowed.

## Emergency stop race

Emergency stop wins even after proposal approval. The gateway must fetch current account state
and rerun deterministic checks immediately before signing. If a transaction was already
broadcast, reconcile it; never describe an accepted transaction as cancelled.

## Venue degradation

Remove the venue from `CERTIFIED_VENUES` or open its runtime circuit breaker, then restart only
the execution gateway. Analysis may continue with degraded evidence, but Pro/Max execution
requires quorum and healthy critical inputs. Re-enable only after sandbox replay, reconnect,
nonce/idempotency checks, and a funded canary succeed.

## Read-only venue routing

- Open `/agent-lab` and use **Venue routing lab** to exercise mainnet public quotes without a transaction.
- Open `/venues` to configure account readiness. Enabling a venue records setup intent only; it does not
  create credentials, fund an account, or authorize trading.
- Open `/trade/BTC`, preview a route, and verify the table distinguishes **ready**, **setup needed**, and
  **excluded** venues. The simulation button must state that no funds moved.
- Open `/swap` to request a Uniswap quote. Do not enable approval, signing, or broadcast during this phase.
- If a venue adapter degrades, leave it excluded. Do not substitute a fixture or claim executable depth.
- Redis keys use `routing:markets:v1` and `routing:preview:v1:*`; clearing them forces safe rediscovery.

## Feature 17 local qualification fixture

- Start only the isolated Test Center under its normal loopback, allowlisted-subject,
  frozen-SHA, Manual Guard and Lite Mode checks; Feature 17 starts off.
- Enable its two-hour feature-scoped local lease, run a checked-in scenario, and inspect
  the frozen receipt. It may report fixture status only, never product qualification.
- Demote by resetting the Feature 17 lease or letting it expire. Preserve migration 029
  evidence; do not delete, rewrite, or treat a synthetic result as staffing approval.

## Feature 18 mandate-policy semantic fidelity fixture

- Enable only the feature-scoped local Test Center lease, run a checked-in scenario,
  and verify the output says product/effective authority unavailable and authority none.
- Demote by resetting or expiring the lease. Preserve migration 030 evidence; rollback
  is a new local typed compile/test/diff/consent operation and never changes a customer policy.
