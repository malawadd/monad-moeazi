# Stage 3 progress: financial admission and command recovery

Continues [the initial progress record](stage-03-progress.md). Stage 3 is still
unpublished; Q4 has not passed. No application database migration, Stage 3 image or
Convex deployment is claimed here. All SQL qualification uses disposable databases.

## Regression checkpoint and terminal proof repair

The supervisor's broader Stage 3 suite passed **205 tests, 2 skipped**, in 105.36s.
It included actual disposable SQL and opt-in local Temporal tests; separate
OS-process tests were intentionally not enabled in that invocation. One existing
FastAPI/Starlette test-client deprecation warning remains.

Independent review then demonstrated three gaps in cancellation terminal proof:
a valid foreign-run permit, an unrelated settled reservation, or a shorter stored
order quantity could satisfy the projection checks. The supervisor bound scope,
run, manifest, reservation, quantity and all immutable projected order fields to
the hashed permit. Independent adversarial/happy-path tests pass **7/7**. This is
proof-boundary validation, not a substitute for financial settlement qualification.

## Exact phase recovery

The proposed SQL070 advance-start-counter design was rejected before application.
An API stop can change the run revision without completing the activity's economic
step; preparation can also mutate financial state without changing the run counter.
The draft and its unused helper were removed by their author. Migration discovery
now contains only the replacement `070_simulation_phase_receipts.sql` at number 070.

Replacement SQL070 was independently reviewed, then applied twice only to
`moeazi_q4_20260930`, SHA-256
`81ed362e7345cb0efcbddb093fa7e43014720428f3c6338f2ab7fe31094545f1`.
It stores immutable command/phase/input identities and original JSON responses,
including no-ops. Scope/manifest checks, experiment-only restrictive RLS, bounded
payloads, and SELECT/INSERT-only simulation-role grants remain enforced.

Controls, source folds and financial checkpoints load prior receipts before work
and write receipts in the same transaction as their effects. Skipped phases are
durable, so later inputs cannot change an earlier no-op during activity recovery.
Cursor advancement retains its existing atomic SQL069 command receipt. The entry
phase has an outer durable response around its exact-request, preparation and
submission identities; its complete crash qualification awaits actual admission.

Evidence at this checkpoint:

- Independent restricted-role receipt tests **2/2**: canonical Unicode and large
  integers, changed inputs/results, forged hashes, immutable writes, live-scope
  rejection, and unchanged replay after an unrelated run projection update.
- Backend actual SQL hook test **1/1**: fold and checkpoint replay return their
  original result; a different command sees zero new folds or a duplicate snapshot.
- Supervisor actual SQL recovery tests **2/2**, within a **13/13** focused suite:
  a later cancellation cannot alter an old control no-op; lost response after a
  committed fill plus a concurrent stop replays that fill phase without another
  journal entry or proceeding to the checkpoint phase.
- Actual SQL/Temporal empty-run and hook/receipt suites together **5/5**.

Supervisor receipt rollback/recovery plus actual partial OS-process restart now pass
**4/4 in 47.80s** on the integrated phase implementation. The control dispatch and
receipt roll back together when failure is injected after insertion before commit.
Independent fold/checkpoint atomicity checks pass **2/2** under the narrow login:
source/journal/position or derived snapshot/checkpoint/outbox effects and their
receipt roll back together, then the same command commits once on retry.
The real worker restart still retains partial exposure and submitted capacity;
these results do not qualify settlement, protection, closure, or all crash windows.

## Current ownership and critical path

Backend owns transactional replay admission, reservation settlement and the financial
lifecycle. Product owns pure sizing and exact source selection plus preparation/start
integration. The supervisor owns SQL070, phase dispatch, API/runtime and process
integration. The independent verifier owns adversarial checks and acceptance evidence.

The admission loader validates stored evaluation, evidence/dataset, account snapshot,
policy, positions and pending obligations. Its narrow-role SQL check passes; it has
not yet written a qualified replay reservation. Pure sizing now explicitly receives
the accepted evidence and frozen dataset so it cannot substitute an unrelated book.
Both remain intermediate work until the actual financial path passes.

## Protection obligations and first real replay entry

Independent pure sizing oracles pass 4/4, separate from product's own cases. Backend
and product have now connected a qualified spot replay fixture through evaluation,
exact receipt, transactional capacity reservation and intent, preparation and
simulated submission. The restricted-role SQL case passes with one hold/order and
stable retries. Perpetual/third-asset admission and financial terminality remain open.
An earlier nonfinancial processor fixture correctly failed because its policy had
zero fee allowance; a qualified fixture was added instead of weakening that gate.

Protection semantics are explicit: the current model supports an immediate
reduce-only market request. Its acceptance is not a resting stop-loss certificate
or proof that the position is flat. The portfolio view now publishes that limitation,
and both run completion and close proof treat accepted protection as still pending.

SQL071 introduces immutable, canonical, source-fill-bound protection obligations.
Independent pre-apply review rejected an initially proposed unqualified resolved
state and nullable new origins. The revised migration introduces no terminal state;
new rows require an exact preimage and a deferred commit-time relationship to the
increasing order, required-protection intent, journal-linked folded fill, position
revision and filled quantity. One fill cannot create two obligations. Legacy rows
remain unqualified and cannot gain a fabricated origin through mutation.

After review, SQL071 was applied twice only to disposable Q4 at SHA-256
`b79c57b1e44b09655a9b2d22b503ad7e126c14323add95525ed549765ca5c2de`.
Pure obligation source tests pass 3/3 after fixing state-registry/direction binding.
Actual SQL source qualification and fold integration are in progress. No protective
request, fill, settlement or flat-position success is established by these types.

Root owns protection helpers/supervisor and the eventual source-backed resolution
contract. Backend owns fill hooks, financial settlement and replay cursor scheduling;
product owns preparation/start and exact perpetual/third-asset compatibility. Replay
deadlines must be scheduled explicitly even when no future market fact exists.

SQL071 source qualification subsequently passed **2/2** independently: a genuine
increasing fill creates exactly one intended obligation; null/non-fill/unfolded
origins and mutation/deletion fail without adding or changing rows. Backend's
connected replay-entry test also verifies intended-protection insertion from the
actual fill transaction. The accepted-state protective request is not tested yet.

The supervisor added deadline candidates to replay cursor selection. Its real
restricted SQL test advances to a fill-bound protection deadline after the last
market fact, keeps the exact old market evidence, and replays the same cursor claim
on retry. Out-of-scenario deadlines remain unresolved; no book freshness is invented.
This passed in a **9/9** deadline/admission/processor suite. A test-construction
serializer warning was then removed by preserving typed inputs. Reaching a deadline
does not yet dispatch a protective order.

The temporary optional financial-owner lookup was removed after actual spot
admission/submission qualified; unsupported paths now use the financial owner's
explicit gates. Required-protection defaults remain conservative. Full public-path
open/increase/reduce/close qualification needs a versioned protection policy that
explicitly governs increases; the maximum-unprotected deadline is not permission
to add risk. Do not disable protection or author permits merely to pass that test.

Backend owns forthcoming SQL072 reservation-resolution proof and settlement;
supervisor reserves SQL073 for a later source-backed protection resolution contract.
Neither is applied at this checkpoint.

## Deadline containment and explicit experimental increase policy

Root's `process_protection_deadlines` now contains a due obligation without using
research, provider credits or browser state. It atomically stops entries, preserves
the obligation and submitted hold, records an escalation reason and saves the exact
phase response. Actual deadline plus phase-recovery checks pass **4/4 in 7.61s**.
This is containment, not protective reduction or position closure.

Product added an optional content-hashed historical protection policy to the run
manifest. Absent policy preserves the exact previous JSON and manifest hash.
Independent contract tests pass **13/13**. Explicit policy can permit increases only
before the earliest existing obligation deadline, subject to separate financial
and authority checks; every increasing fill still creates required protection.
Its only supported deadline action is `stop_and_escalate`. Runtime SQL increase
qualification remains open. The one-hour schema bound is a technical input bound,
not a validated mobile risk limit.

Product's initial preflight checked modeled future fills before submission. Review
subsequently identified this as future-information leakage; it must not establish
fair strategy performance. The corrective causal model is described below.

The spot third-asset path passed actual SQL **3/3**: separate ETH reservation and fee
fold, stable ordinary path, and insufficient ETH rejected before any hold. Perpetual
preflight is implemented but its public admission gate remains closed pending proof.

SQL072 reservation resolution was applied twice only to the disposable Q4 database.
Its frozen SHA-256 is
`8695c293d96ea0ccdf487934bbc596e0af9a246a8eec31da8590d349f3ef6787`.
Independent review required terminal cumulative/permit identity, exact terminal-event
pointer, hold proof hash, current account revision/snapshot, and matching
reconciliation/root lineage. Backend and independent restricted-SQL tests each pass
a genuine partial-fill/cancel settlement. Independent failure injection after the
hold update rolls back hold, revision, proof and receipt; retry commits once and
returns the exact prior response. Zero-economic and multiple-hold cases remain under
qualification. SQL073 protection resolution has not been written.

## Causal replay correction — required Q4 gate

Full-future simulation preflight currently lets future fill prices, fees and depth
conflicts determine whether a present order is admitted. This can censor adverse
outcomes. Existing v1 lifecycle tests remain bounded software evidence, not fair
backtest or strategy-performance evidence.

A new explicit model version must bind execution limits, time in force, maximum fill
count and conservative fee budgets using only the accepted current observation and
static scenario rules. Future books allocate depth and produce fills or residual
cancellation when their source time arrives. Dispatch-permit expiry is distinct from
order time in force. Old model hashes and history are preserved. Prefix-invariance
tests must prove that different future prices do not change present admission.
Negative funding also requires a retained account obligation after entry settlement;
an order fee hold cannot stand in for this capability. These are required repairs,
not optional research enhancements.

Root integrated settlement into public advance after reconciliation and before
protection/entry work. A genuine partial-fill/cancel run progressed using server-owned
cursor advances; an injected lost response after committed settlement replays the
same proof and account revision. This test plus prior phase recovery passes **4/4 in
10.18s**. Backend's zero-fill rejection test also releases against the authentic
opening snapshot without a fabricated derived observation.

Independent deadline tests now cover a stored no-op before the deadline, retry after
the deadline, and two concurrent new commands: only one escalates and no hold is
released (**3/3** origin/deadline suite). Restricted-worker role checks require
SQL070/072 immutable tables and SQL071 protection permissions; missing grants,
extra update/delete and dropped RLS are rejected (**11/11** role suite).

SQL073 was reviewed and applied twice only to disposable Q4; frozen SHA-256:
`d67c01d1810a141bbf09e55c3c3cc068724ef86fae11234db5ca60681750a0b2`.
The flat-resolution phase is connected after settlement. It preserves original
protection acceptance/rejection history and requires exact current flat position
state, reconciled source roots, terminal order proofs and disposed reservations.
SQL guards lock financial state and reject invented proof/link/pending-clear writes.
Historical proof links remain valid across later position cycles; every currently
unresolved obligation must be covered before clearing a position's pending flag.

Independent actual-Q4 negative/no-op tests pass **2/2** and role drift tests pass
**11/11**. An integrated public-advance test initially caught a missing `resolution`
phase whitelist entry; after repair the lost-settlement-response and SQL denial
checks pass **2/2 in 7.67s**. These are not positive close evidence. Resolution-aware
queries ignore linked historical obligations for pending work; portfolio output
separately exposes total, unresolved and resolved protection counts.

Protective-rejection terminal facts now require the exact protective order identity
and are recognized as rejected-order outcomes; focused control proof checks pass
**9/9**. A true close through the causal model, atomic resolution rollback and full
process recovery remain required before claiming complete protection capability.

The next maintenance path is an explicit authenticated `request_close` linked to
the complete set of source-bound obligations and an exact current residual. Its
simulated reduce-only authority may survive an entry stop; `stop_and_escalate` alone
does not grant automatic closure. SQL074 is backend-owned and remains a draft.

## Immutable-source flatness regression and causal integration

Independent adversarial review found an SQL073 gap after a genuine fill,
reconciliation and settlement: rewriting only the mutable position projection to
zero could satisfy the flat-proof trigger while immutable source roots still
represented open exposure. The rollback-only reproducer confirmed this; Python's
independent oracle was stricter than the SQL boundary.

SQL075 supplements the frozen SQL073 migration with a zero signed sum of immutable
folded fills for every location, exact journal/source links, quantity identity and
perpetual derived-position registry/margin checks. It was reviewed and applied twice
only to disposable Q4 (it depends on SQL073, not the still-unapplied SQL074).
Frozen SHA-256:
`9fc67e2b396c278627f9fd295e0f0e272c1b3ac7cbea1f89cff607e96eda78f1`.
The exact previous exploit now passes as a denial regression **1/1**: exposure stays
open, the obligation stays unresolved, and no flat proof persists. Positive closure
is still unqualified.

Causal source review also caught post-cancel depth consumption, a shared-depth key
overwrite and unbounded fee growth at improved sell prices. Product repaired these
and added bounded source-time debit/fee caps. Independent depth and sell-fee checks
pass **2/2**. Dataset quality is an explicit pre-order qualification gate; integrity
failure must preserve previously persisted source. Studies are conditioned on that
qualified corpus, and these software checks do not establish strategy performance.

Actual guarded dataset/route and causal tests passed **11/11** at their checkpoint.
The first complete causal spot SQL test stopped on a fixture writer-lease mismatch.
After using the legitimate existing writer, the actual restricted public flow passed
**1/1 in 4.66s**: registration, dataset, queue, evaluation, exact hold, preparation,
submission, source fold, checkpoint and settlement. Receipt and permit share the
same execution-envelope hash; no production gate is monkeypatched. This qualifies
the bounded spot flow, not automatic protection or strategy performance. SQL074/076
maintenance and owner provenance remain in progress. Root's API now forwards the
authenticated actor; historical commands without one cannot grant maintenance.

SQL074 final SHA-256
`9770a381d4dd06d6c3ad8a69dca830139f40d5802073ab4e35335bcfd9aff3a7`
was reviewed and applied twice only to disposable Q4. It adds immutable owner actor
provenance and a mandate bound to an exact close command, position, sizing receipt,
hold and complete source-obligation set. Child links cannot be extended after
commit. Root's actual owner/retry/control/HTTP suite passes **6/6 in 14.52s**.
Independent causal/data/false-flat/role checks pass **22/22** in their bounded scope.
These do not establish a submitted maintenance order or completed closure.

SQL076 and the dedicated maintenance writer remain in progress. Each close attempt
needs a distinct immutable order identity so a rejected attempt cannot erase prior
history or permanently block an authorized retry. Typed simulation maintenance may
reduce exposure when account admission is `open` or `stopped`, but still requires
clean reconciliation and a current authority epoch bound to its mandate. An epoch
change after mandate creation fails closed. Ordinary entry and native credential
guards are not relaxed by this simulation authority contract.

Remaining Q4 requirements include real spot/perpetual/third-asset-fee admission and
settlement, multiple valid orders, continuous protection, protective closure,
authority changes and full crash recovery. Stages 4–8, live qualification and three
final validation cycles remain pending.

Further work is recorded in [the third progress record](stage-03-progress-03.md).
