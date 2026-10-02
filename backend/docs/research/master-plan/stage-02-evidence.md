# Stage 2: observations and financial authority

2026-09-30. Acceptance record for [Stage 2](stages-01-02.md).
Supervisor accepted Q2 recorded-replay software and Q3 experimental financial core
after independent review, deployment and the controlled Redis restart check. The
implementation is additive to Stage 1. This acceptance enables Stage 3 simulation;
it does not certify operational clocks, native accounts or funded trading.

## Delivered boundary

The shared backend now has typed, immutable observation records; exact native-unit
journals; account-scoped reservations; fenced financial writers; reconciliation;
and a transactional outbox publishing display projections to Convex. Authenticated
financial reads derive account ownership on the server. Unknown state stays unknown.

Native recorded Hyperliquid responses are parsed with explicit instrument, unit,
time and provenance checks. The account writer currently admits only experimental
account observations. It cannot bootstrap a real customer account from a fixture.
Live admission remains disabled, including through account stop/resume commands.

Reservation admission is serialized per account and includes other teams and
withdrawals. Pending buys contribute to exposure. An evidence hash cannot override
the price or exposure extracted by the server. Possibly submitted reservations
survive expiry. Proof-backed experimental settlement checks the submission identity,
matching journal, later account observation and every unrelated retained hold in
one database transaction.

## Evidence register

| Evidence | Result and meaning |
| --- | --- |
| [Q2 frozen corpus and qualification](q2-replay-qualification.md) | Recorded-replay software pass; ten hashed raw samples, including one admitted native BTC snapshot and explicit time/clock exclusions |
| [Independent verification](stage-02-independent-verification.md) | Independent Sol review and guarded real-Postgres accounting, concurrency, recovery and authority tests |
| `npm test` | 277 passed; `.data/stage2-typescript-regression.log` |
| Production Next.js build | Passed, including lint/type validation; `.data/stage2-build.log` |
| Full Python regression | 892 passed, 33 skipped; `.data/stage2-python-final.log`; separately, guarded Stage 2 run passed 120/120 with zero skips |
| Evidence sink inventory | TypeScript and affected Python inventory checks passed; new writes have explicit ownership |
| Convex development deployment | Additive schema/functions deployed to `outgoing-spider-101`; `.data/stage2-convex-deploy.log` |
| Deployed Convex checks | 14 passed; `.data/q3-projection-1790777792649.json` |
| Actual SQL → HTTP worker → Convex bridge | Passed remote-commit/response-loss, retained outbox, duplicate acknowledgement and authenticated exact readback; `.data/q3-bridge-1790778106879276100.json` |
| Controlled Redis restart | Passed; observed Redis process identity changed, SQL hold/state/outbox unchanged and over-reservation denied; `.data/q3-redis-process-restart.json` and `.data/q3-redis-restart-result.json` |

The bridge used a separate disposable database and an unfunded synthetic Q1
account. It published stopped/unknown state. Its two-attempt recovery and readback
took 3.078 monotonic seconds; this is a bounded test measurement, not a capacity or
continuous projection-lag SLO. The earlier CLI qualification attempt failed because
its harness parsed an empty successful null response as JSON; the corrected harness
passed. No application behavior was relaxed for that failure.

A subsequent bridge run, `.data/q3-bridge-1790780168419095900.json`, also passed.
Its first actual publication took 0.234 seconds for the HTTP round trip and reached
acknowledgement within 0.250 seconds after the SQL commit returned. These are
monotonic, one-sample measurements; they exclude a sustained backlog and do not
establish an operational latency target or distribution.

The verifier prepared an experimental account with balance/capacity 100, held 70
and available 30. The supervisor restarted only the local Moeazi Redis container,
observed a changed `run_id`, and ran the second phase with a new repository/pool.
Balance, reservation, account revision, authority epoch and outbox identity matched
the checkpoint; a new withdrawal reservation of 40 failed as over-reserved. Analysis
workers stayed stopped. A duplicate prepare attempt harmlessly refused the existing
checkpoint; it neither replaced evidence nor created another reservation.

The first full Python invocation used `agent-service` as its working directory and
reported twelve failures from repository-relative source discovery. Its log remains
at `.data/stage2-python-regression.log`. The final run uses the repository root;
the harness error is not classified as an application regression.

## Migration and deployment

Reviewed migrations applied successfully twice to `moeazi_q3_20260930`:

| Migration | SHA-256 of inspected local bytes |
| --- | --- |
| 055 finance authority | `e94479d9fb0f31bf789328446983e04d589287214b5f11c25da5c334cbce9b82` |
| 056 observation registry | `170b978a1103375c05ed08dd79c865f0a779a566fa42e45576336389733c13e0` |
| 057 experiment resolution proofs | `2bbf435510a878ce6aec55053cc3787fb4a4ec699ae800285327808d2201f660` |

All three migrations subsequently applied successfully to the local `moeazi`
application database. New financial account/journal and observation snapshot tables
were empty after migration; no qualification balances were imported. One inspection
query used the wrong table name, then the corrected read confirmed the empty tables.
Each migration itself committed successfully without error.

Python API, gateway, analysis/evaluation worker and Test Center images rebuilt
successfully. API/gateway/Test Center were recreated; analysis/evaluation workers
remain stopped. The read-only deployed API check passed six assertions: health,
unauthenticated rejection, unknown unbootstrapped account, unknown rather than zero
withdrawable units, missing experiment identity rejection, and no financial write
route. All 27 inspected deployed Python source hashes match local source. Evidence:
`.data/stage2-deployed-api.json`, `.data/stage2-image-build.log` and
`.data/stage2-services-restart.log`.

| Running image | SHA-256 |
| --- | --- |
| API | `1fd9a440bab45d5fdc6e6bd1b80c841fdfe5623de5770efc562c64bbd3e10a3b` |
| Gateway | `5bd9f658f164db46b0351b936d59eddb43fa2de778f23e2284f530c3678d3fca` |
| Test Center | `c9138705c90f20bbbe483638570298508a3ca514dac6a253c125110900b80925` |

SQL tests use a dedicated loopback proxy to Docker Postgres;
the unrelated Windows Postgres listener is not used. Test data is not copied into
the application database.

## Deliberate limits and remaining gates

- Q2 does not certify continuous ingestion or healthy clocks. The host was about
  1.4 seconds slow during read-only diagnostics; runtime capture also observed a
  wall-clock step. Approval to change Windows time remains pending. Raw timestamps
  and strict future-data rejection are preserved.
- Financial observations and resolution proofs are experimental. There is no
  qualified native account bootstrap, real position reconciliation or real
  withdrawable-balance certificate.
- Full single-fill spot/zero-fee withdrawal resolution is qualified in simulation.
  Partial/cumulative fills, fee-bearing settlement, collateral and perpetual
  positions remain held or quarantined until Stage 3 adds their complete lifecycle.
- Generic journal tests cover partial fills, third-asset fees, funding, gas,
  collateral/transit transfers and cashflows. This proves accounting primitives,
  not venue margin rules, executable protection or profitable strategy behavior.
- Convex is a last-published display projection. Admission rechecks authoritative
  database state, freshness, policy, revisions and writer/authority epochs.
- Analysis/evaluation workers remain stopped. Manual Guard and Lite remain on;
  background ingestion, mainnet setup and live execution remain off. No provider
  call or funded trade was needed for Stage 2 qualification.
- Python dependency drift observed during the earlier rebuild remains an explicit
  reproducibility task for Stage 8; image hashes identify what was actually run.

Rollback stops new financial admissions and writers, retains journals and uncertain
reservations, and requires reconciliation before an epoch handoff. Do not drop
financial tables, discard unacknowledged outbox events or reinterpret unknown state
as a zero balance. Existing product interfaces remain available.
