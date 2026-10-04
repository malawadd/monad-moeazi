# Financial authority and native observations

Stage 2 introduces an ordinary PostgreSQL financial writer in `finance_*.py` and
migrations 055/057. These tables are operational account state. The older
`risk_*` and `journal_*` tables from migrations 021/022 are Test Center fixtures
and must never be imported as balances, reservations, or live capacity.

## Ownership

- `FinanceScope` binds environment, scope ID, and strategy account ID in every
  account lock, journal row, reservation, claim, and outbox event. Live uses
  `scope_id=live`; an experiment uses its immutable experiment-spec ID.
- Observation migration 056 keeps immutable instrument versions, market events,
  replay evidence, and account snapshots. An account snapshot names exact asset
  units, registry hashes, location, book, native integer balances, source account,
  rights, finality, and event/availability/receipt/cutoff times. A recorded fixture
  can qualify only experiment scope. There is no live native account writer yet.
- `FinanceRepository` locks the scoped account row in PostgreSQL, checks the
  database-time writer lease and epoch, revision, stop state, policy, and fresh
  reconciled observation before admitting experiment risk. SQL journal postings
  are immutable and balanced per asset at commit. Reservation components for
  trades and withdrawals consume the same asset/location capacity pool.
- Convex receives a versioned current projection through the finance outbox.
  It is a viewer cache, not a ledger or spending authority. Outbox delivery is
  at least once and is invoked as a bounded batch; it does not poll Convex.

A cached `reconciliationState=clean` describes the last published state at its
`observedAt` and `asOf`; it is not a continuously renewed freshness guarantee.
Every action rechecks the SQL database clock and current policy through the
financial writer. The UI must never treat a cached clean projection as spend
permission. Stage 2 has no background expiry publisher or scheduler.

All native amounts are canonical integer strings at the API boundary. PostgreSQL
`numeric` values are decoded only after integral, finite, and bound checks. There
is no implicit conversion between assets or decimals. A spot sizing receipt cites
an accepted stored book and registered instrument; the server derives its bid/ask
ratio and current plus pending exposure. Caller prices and asserted zero exposure
cannot grant capacity. Perpetual sizing and unvalued positions are denied.

## Reconciliation and uncertainty

Bootstrapping an experiment requires a complete, final, fresh account snapshot
whose digest, scope, source account, rights, and policy match. A mismatch commits
unknown or quarantined state and blocks new risk. Out-of-order journal facts stay
pending and cannot be cleared by an otherwise matching snapshot. A new observation
below retained holds publishes the signed deficit and quarantines admission.

Submission start is recorded before any possible venue action. An expired
reservation with no attempt may be released; submitted or uncertain holds stay
reserved. Migration 057 and `finance_resolution.py` support experiment-only,
hash-bound recorded proof fixtures. Exact later account evidence and, for a fill,
an exact complete journal event must match before one target hold can settle or
release in the same SQL transaction. These fixtures are not native venue no-fill
certification or permission for live settlement.

## Verification and remaining gates

Use the root-managed disposable local PostgreSQL database for SQL055/056/057
integration tests. Never point the harness at the application database. Current
focused tests cover journal balance and append rejection, semantic idempotency, source
corrections, exact spot and funding/cashflow oracles, serialized team/withdrawal
holds, writer fencing, stale evidence, retained uncertainty, and outbox replay.
Proof-backed recovery database tests passed independently in the experiment scope.
See the [Stage 2 evidence](../research/master-plan/stage-02-evidence.md) for actual
deployment, acceptance and remaining limits; code presence alone is not certification.
The account clock must be ready: future timestamps fail closed. A passing fixture
suite does not prove live market time or source clock synchronization.

Live bootstrap, native account/fill/no-fill proof ingestion, perp position and
collateral accounting, private signing, and funded venue execution remain gated.
The gateway can read-check an exact existing live `possible` submission marker
against a current complete native snapshot and approved live policy, but no
product writer can yet create that marker or its authoritative native source.
See [Stage 2 implementation](../research/master-plan/stage-02-implementation.md)
and [known gaps](known-gaps.md) before claiming completion.
