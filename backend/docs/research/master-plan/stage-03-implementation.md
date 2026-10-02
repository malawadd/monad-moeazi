# Stage 3 implementation: complete simulated trading lifecycle

Started 2026-09-30 from accepted Stage 2 `f921dfe`. This implements
[the existing Stage 3 brief](stages-03-04.md); Q4 has not passed. Q1 identity,
Q2 recorded-replay software and Q3 experimental financial accounting passed.
Continuous market-clock readiness and native financial authority remain unqualified.

## Outcome and ownership

A backend-owned experimental account must take versioned strategy intent through
exact sizing, reservation, simulated orders, partial fills, fees/funding, position
protection, close and crash recovery. The existing financial journal remains the
only operational balance writer. A separate console is not required for Q4.

| Owner | Exclusive write boundary |
| --- | --- |
| Backend Sol | Shared lifecycle contracts, order/position/protection repository, additive SQL058 onward, finance extensions and their implementation unit tests |
| Product Sol | Deterministic simulation source adapter, replay/strategy adapter, optional engine comparison harness and component decision evidence; no direct schema or finance edits |
| Independent Sol | Independent hand-calculated scenario corpus, adversarial lifecycle tests and Q4 verification report |
| Astra | Temporal workflow/activities/isolated worker, authenticated API/Convex integration, shared configuration/inventories, SQL061 scoped database credential boundary, migration application, deployment, acceptance and Git |

First freeze shared Python types and function signatures with all owners before
dependent implementation. Backend owns lifecycle/financial migrations, with SQL061
explicitly assigned to root for role/RLS isolation; root alone applies migrations.
No worker agent deploys, commits, pushes, changes clocks or
starts analysis workers. New files stay within 300 lines. Preserve legacy interfaces.

## Shared contract requirements

Reuse `FinanceScope`, `ControllerRef`, `InstrumentVersion` and evidence identities.
Do not invent another customer account ID or an independent simulator cash ledger.
Use strict versioned contracts and exact canonical native-unit strings:

- `TradeIntent`: scope/controller version and customer mode, immutable strategy
  artifact, instrument version, action/side/target exposure, horizon, evidence and
  calculation references, explicit invalidation, expiry and protection requirement.
  Abstention/hold emits no executable order. A claim is a supplied reference until
  verified; typed prose alone cannot establish a price or exposure.
- `ExecutionPermit`: scope, order/client identity, canonical payload hash, quantity,
  reservation, account revision, writer and authority epochs, policy/evidence hashes,
  validity and simulation transport ceiling. Never authorize native transport here.
- `ExecutionEvent`: immutable source identity, order/client/attempt binding, sequence
  and event/availability time, exact quantity/price/fee/funding fields with units,
  simulation model and dataset hashes, kind, provenance and normalized content hash.
- `PositionProtectionState`: account/instrument and originating management version,
  exact exposure and attributed fills, intended/requested/confirmed/rejected
  protection, independent reconciliation state, retained obligations and reason.
- `ReconciliationResult`: account/order source evidence, cumulative filled and
  outstanding amounts, terminality/protection evidence, journal/checkpoint links,
  retained capacity, uncertainty and explicit unsupported mechanics.

Customer modes remain Shadow, Approval and Autopilot. Simulation provenance is a
separate dimension. Approval binds the exact intent/payload/expiry and is rechecked
after material changes. A simulated approval cannot authorize a live account.
Dev guards remain independent and enabled. Old quote-only Shadow records retain
their historical meaning; do not relabel them as fill histories.

## Persistence and lifecycle rules

Store scoped immutable order events and durable current order/position/protection
state alongside the existing journal. Stable economic identity survives retries,
worker replacement, response loss and duplicate/reordered source observations.
Replay an incompatible or conflicting identity as an error, not a new order.

Only the financial owner admits new risk. Persist submission intent before possible
acceptance; lost acknowledgements remain uncertain and cannot trigger a blind
resend. Reconcile simulated acceptance by stable source order identity. Partial
fills update actual exposure while unfilled/uncertain quantity retains capacity.
Terminal cancellation of a remainder does not close the filled position.

Extend the current spot-only full-fill resolver through cumulative, immutable
execution evidence and exact journal links. Do not weaken its checks by allowing
caller-supplied terminal labels. Experimental source proofs come from the stored
simulator event history; the Stage 2 manually authored proof fixture is not the
general lifecycle authority. Intermediate journal/observation disagreement blocks
new risk until the durable reconciliation sequence completes.

Implement a declared linear-perpetual model with explicit multiplier, settlement
asset, margin, collateral and funding rules. Track realized versus unrealized P&L,
fees and external cashflows separately. Missing/stale mark or unsupported margin
semantics produce unknown exposure. Do not net opposing team obligations into
fictional spare collateral. Unsupported inverse contracts or AMM mechanics cannot
inherit linear/CLOB qualification.

Protection has its own durable state and policy. Intended protection is never
confirmed protection. Partial entry, cancel races and rejected protection must
leave visible exposure and trigger the bounded configured response. Stop-new-entry
blocks additional risk while authorized reductions remain possible. Revoked native
authority is not invented for an exit. Research/analysis credits, cancelled research
jobs and closed browsers cannot own or terminate an account's protection loop.

## Simulator and engine boundary

The first source adapter is an explicit deterministic model consuming frozen
observations, instrument versions and a versioned scenario/seed. It emits immutable
order/fill/cancel/funding/protection events. Production code derives exact journal
effects and later simulated account observations from that log. It cannot import a
signer, venue private client, provider key or live dispatch route.

Recorded replay and forward-shadow share contracts, but recorded Q4 tests cannot
certify continuous forward ingestion or unhealthy clocks. Test-generated price
paths remain synthetic. Declare spread, depth/participation, latency, fees, funding,
rounding, liquidation assumptions and unsupported queue/AMM behavior.

Qualify installed NautilusTrader 1.231.0 in its isolated environment against the
same hand-calculated scenarios. Inspect that version's APIs; current 2.x examples
are not interchangeable. Record exact discrepancies, limitations, resource use and
license/dependency ownership. It remains a prototype unless it adds demonstrated
value through these contracts. A failed comparison yields a documented rejection
or narrower disposition, never an unqualified live engine replacement. A Freqtrade
candle comparison is optional when its assumptions help a concrete decision.

## Durable integration

Add versioned simulation workflows and a dedicated Temporal queue. Never register
new handlers against old execution histories or consume the existing analysis queue.
Use the actual backend storage and account identity, with isolated experiment scopes.
Root starts only the dedicated simulation worker with provider and signing paths
unavailable; regular analysis/evaluation workers remain stopped.

Temporal owns durable coordination; SQL owns financial/order idempotency and fenced
state. Activities may retry only with their original economic identity. Rehydrate
from persisted source events and financial state after restart. Bound batches and
timers; no idle Convex polling. UI publication uses durable outbox semantics.

Existing experiment identity metadata is explicitly non-executable. Add a distinct
validated simulation-run manifest and authority check rather than silently treating
old metadata as execution permission. Authenticated server context resolves account,
experiment and controller; arbitrary payload JSON cannot select a live account.
Operator/run APIs must expose simulation and protection status truthfully.

## Q4 acceptance before publication

1. Hand-calculated spot buy/sell and linear-perp open/increase/reduce/close agree
   exactly with fills, rounding, third-asset fees, funding, collateral and equity.
2. A partial entry followed by real worker restart retains exposure, reservations
   and protection obligations. Cancelling its parent research job cannot erase them.
3. Response loss before/after simulated acceptance, duplicate and reordered fills,
   cancellation races and rejected protection converge without duplicate spending
   or fabricated success. Unknown residual exposure stays held.
4. Stop, authority change and stale data have tested precedence. Entry requires
   clean financial state; permitted protective reduction follows its explicit
   policy, and a failed reduction remains visibly unresolved.
5. Research outage, empty provider budget and closed console do not prevent the
   isolated durable supervisor from processing protection and reconciliation.
6. The same manifest/seed yields the same economic replay. Different experiment
   scopes cannot mutate each other's state; simulation cannot reach a signer or
   write live financial projections. Test all customer modes independently.
7. Engine comparison or rejection is evidenced. No unsupported simulator mechanic
   receives a parity or venue-certification label.

Root applies reviewed additive migrations first to a disposable qualification
database, then the local application database after independent review. Test real
SQL and Temporal paths, rebuild changed Python images, check deployed interfaces,
and only then commit/push the accepted stage with the user's short subject format.
Full Q4 must pass before Stage 4 executable experiment/console acceptance.

## Rollback, costs and unresolved capabilities

Disable new simulated entries and retain compatible supervisors for existing
experimental exposure. Preserve journals/events/holds and reconcile before writer
handoff. Do not delete prior interfaces or convert uncertain state to success.

Local simulation requires no paid provider, native venue call or funded operation.
Existing authorized bounded development Convex operations may have unknown usage
cost. No additional metered feed/cloud service is selected. Live venue protection,
native authority, production strategy limits and customer funding remain unavailable
until their later gates pass. No final system-validation cycle has run.
