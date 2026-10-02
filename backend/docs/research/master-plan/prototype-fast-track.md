# Internal trading prototype: working-path checkpoint

## 2 October 2026: exact Magic owner assigned to the first live-path program

The development Convex bootstrap now selects the strategy bound to the exact
signed-in Magic owner, even if legacy Particle wallet rows also exist. Its
idempotent operator call staged frozen program version
`wx7fe9v185r0gcs20rcfzdb9nx8fhx1c` for
`0x56b6c8ef6e04fa995f835f56c009f01623af5963` as paused assignment
`wn73mfajq6wh4qdsnr4211pb6h8fgeaq`. An admin replay of the identity into
the read-only limits query showed that assignment, 25 available credits,
Magic-owner readiness, and the required customer mode confirmation. This
admin read does not prove the signed-in phone session or customer consent.

The next phone action is customer confirmation of Autopilot mode, then choosing
capital and period. Funding preparation must bind the actual EIP-7702 operation
sender to the same Magic address; it rejects a Particle operation with another
sender. A funded vault is reported in the Start review as exact committed USDC,
not a `$0.00` staged-assignment balance. No vault factory, Magic funding
signature, capital transfer, live order, fill, or withdrawal has occurred.
Customer mode confirmation now also advances a `ready` Magic-bound strategy to
`active`, because vault provisioning, native finance activation, managed cadence
and proposal routing all require that state. The assignment remains paused and
cadence remains off until the later funded Start gate passes. The deployed
read-only limits query now reports the frozen policy as valid before mode
confirmation instead of mislabeling it invalid.
The Start review now displays order, exposure and daily-loss ceilings from
that frozen version. The internal spot alpha caps each at $1; the previous
screen would have shown a $25 legacy strategy position limit.
One connected local test now takes a Magic-bound `ready` strategy with a
legacy Particle wallet row through frozen program staging, customer mode
confirmation, mandate creation for 0.50 USDC over seven days, and an owned
vault-provisioning context. It verifies the same Magic owner and program hash
at the end. This is a backend handoff test, not a phone signature or funded
execution proof.
The mobile setup screen now places the older two-scope grant controls behind
an explicit legacy button while retaining them for qualification; the Magic
vault mandate remains the primary visible path.

## 2 October 2026: signed-in Android wallet read through the backend

The existing signed-in Magic Android session opened managed setup from Home. The
mobile client called its authenticated Next.js proxy, which forwarded the owner
identity to the execution sidecar for finalized Arbitrum code and native USDC
reads. After rebuilding the stale sidecar image, the phone displayed **1.095927
USDC** at finalized block **511002105** for the signed-in owner and an EIP-7702
delegate target of `0x13e00e089f81ad9f36b655c9e9a07c6bf1489a5a`. This is a
real account observation, not trading authority. Mobile rejects a response for a
different owner or an inconsistent delegate-readiness claim.

The same mobile journey reports `managedProgramEnrollment: disabled` and no
assignment. Inspection of the development Convex deployment found only two
`q1-identity-only` frozen versions associated with architecture-test subjects;
there is no `agent-v1` operator program to assign to this Magic account. The
current mobile Uniswap setup still asks for separate buy/exit signatures and
allowances, and Start still enables analysis cadence only. Those cannot be
presented as the agreed one-signature mandate. The next connected change must
produce a real versioned operator program and an owned assignment visible to
this same phone, then qualify a single signed capital-and-mandate operation
against its existing delegate without silently switching wallet implementation.

Particle's [Magic plus EIP-7702 example](https://github.com/Particle-Network/ua-7702-magic-demo)
documents one root-hash signature for a transaction after delegation. It does
not document permission for unattended future trades or a segregated program
balance. Its public repository does not display an open-source license, so it
is a design reference rather than code to copy. A one-signature transaction
path and a constrained trading account still need separate qualification.

## 2 October 2026: first-route source connected, runtime and funded proof pending

The implementation now follows one internal Magic owner through an explicit frozen
Uniswap assignment, owner-signed buy and exit scopes, native finance activation,
Temporal managed proposal routing, a finance-held buy, scoped broadcast, and a
confirmed-fill journal/Convex receipt. A zero-WETH wallet can arm its exit scope
before Start; buy activation requires funded USDC and exact allowance. Stop pauses
new entries, stops finance admission, revokes buy scope, and retains only the exact
exit scope for a later bounded close. Withdrawal is blocked while closure is
unconfirmed. These are source and local-test results, not a funded journey.

The buy path passed 19 focused local tests and the new SQL 084 marker/fill schema
passed a transaction-rolled-back test in isolated local database
`moeazi_proto_084_check_20261002`. The normal app database was untouched. Convex
adds an exact-secret reconciliation-only context for lost responses after Stop or
authority expiry. Its confirmed-fill projection is idempotent, including a lost
response after the projection succeeds. A separate exact-secret stopped-program
context and flat receipt are ready for the reduce-only sell. Focused TypeScript and
Python tests pass; none proves native submission.

The stopped-state reduce-only WETH-to-USDC reservation, submission verifier,
finality/journal fold, and authenticated Close API now exist in source. A separate
finalized zero-WETH path handles an account that abstained and never traded.
Mobile exposes Stop, then Close, and waits for a trusted flat projection before
withdrawal. The No-trade and filled-close responses have distinct evidence
contracts. Focused source tests pass, including an unfunded FastAPI-to-Convex
contract test; they do not prove a funded order or complete mobile session.

Convex functions deployed successfully to `dev:outgoing-spider-101` on 2 October.
After recovering Docker Desktop, SQL 085 applied and replayed successfully in
the isolated database; the application migration service exited 0 and both
exit tables exist in the application database. The Python API, workers, gateway,
and sidecar were rebuilt. The running API advertises the activation and Close
routes. A missing production `tslib` dependency initially crashed the sidecar;
it is now explicit and the rebuilt sidecar is healthy. Local scoped-storage
secrets are in ignored `.env.agents`; the AOF and replica durability probe reports
ready. This is infrastructure readiness, not owner grant or native execution.
Live execution and Uniswap signing remain off. The first funded tester and exact
per-account capital, order, loss, and authority envelope are still needed for
an actual trade.

Runtime health presently reports Manual Guard on, scheduled analysis off, and
live execution off; the sidecar's authenticated readiness reports durable storage
ready but broadcast disabled. Start can record an assignment and cadence under
these settings, but it cannot autonomously analyze or submit. A controlled
one-account qualification window must explicitly change these gates and verify
no other schedule becomes active; restoring the default gates ends that window.

The application database currently has zero approved live finance policies and
zero registered Uniswap instruments. The bounded local operator command
`python -m moeazi_agent.managed_uniswap_policy_provision` now validates one
owned explicit assignment against Convex's frozen venue permission and checks
that the supplied exact-pair instrument and finance policy stay within its
native-unit caps and the operator's explicit capital, single-order, daily-loss,
and expiry envelope. It reads reviewed JSON on stdin, reports a dry-run result by
default, and writes only with `--apply`. It does not auto-invent trade limits,
take an owner key, enable submission, or provision an unassigned account. The
selected tester's assignment, pool identity, and approved numeric policy are
required before this command can run against the real account.

The first funded qualification is one buy grant and one exit grant, each limited
to one call. Reissuing grants within a day is not yet governed by a realized-P&L
daily stop; the declared daily-loss envelope must therefore cover the full
single-order USDC input, and no second grant is authorized for that initial run.

This checkpoint applies the [master architecture](README.md) to one funded customer
journey. It records implementation facts, not a substitute for the Q1–Q12 release
gates. Internal testers will supply account-specific capital, order, daily-loss, and
authority-expiry limits before a funded run; the owner deferred that selection until
the unfunded code path is ready.

## Journey and truthful status

| Customer step | Current implementation | Next proof needed |
| --- | --- | --- |
| Fund and withdraw | Existing mobile Magic/Particle and Arbitrum USDC flows remain available, with rollout gates | Test the same internal account and actual settled USDC transfer |
| Assign a managed program | Explicit owned assignment and frozen version; release-authorized Shadow activation | A real tester assignment and version consent |
| Grounded agent decision | Managed manual Shadow analysis and opt-in Temporal cadence use frozen configuration; citation IDs are preserved and checked | Run a real bounded analysis and inspect evidence, calculation, abstention/proposal, usage |
| Deterministic risk | Managed Uniswap buy and stopped exit have native account observations, exact sizing, durable reservations, and retained attempts; SQL 085 is deployed | Run the same owned account through the actual services and inspect its finance revision and hold |
| Arbitrum/Uniswap spot | Owner-scoped grants, quote, prepared call, finance marker, broadcast, receipt, journal, and Convex fill projection are connected; the rebuilt sidecar and API are healthy but defaults disable live submission | Perform one bounded funded buy and observe actual fill/account state |
| Hyperliquid spot and perpetuals | Public exact-address reads, scoped native SDK primitives, and an owner-authenticated mobile binding bridge exist; venue fill history is checked separately from acknowledgement | Run a real binding, activate narrowly scoped permission after independent checks, then integrate deterministic order construction, finance and execution |
| Stop, close, withdraw | Mobile Stop retains the exit grant, Close calls the stopped reduce-only route, and withdrawal waits for the trusted flat projection; abstaining accounts have a finalized zero-WETH branch | Rebuild and run real stopped close, settled USDC withdrawal, and an uncertain-response retry on one account |
| Operator view | Local Node/HTML/CSS/JS console connects to authenticated Moeazi research APIs and reads owned frozen programs, specs, and outcomes | Runtime walkthrough, current assignment/release controls, and actual experiment creation on the same backend |

No route is currently a completed funded Autopilot journey. A submitted order is not
a fill, a venue-reported fill is not an account reconciliation, and a Shadow decision
is not live trading. The mobile start endpoint remains fail-closed and reports the
specific missing prerequisites. The current Hyperliquid setup callback previously
accepted a caller-supplied `verified` boolean; the prototype work closes that path
until an independent protocol verifier exists.

## Next vertical slice

1. Run one unfunded authenticated mobile walk-through with the real backend and
   exact internal assignment: Start, grounded proposal or abstention, Stop, Close,
   and withdrawal eligibility. Record any missing seam rather than treating
   isolated source tests as completion.
2. Set one tester's explicit financial and venue-authority envelope, then qualify
   a real Uniswap buy, finalized fill, stopped exit, reconciliation, and settled
   withdrawal. Test one lost response using the same durable key.
3. Bring Hyperliquid spot and perpetuals through the same live account, finance,
   attempt, fill, stop, close, and withdrawal contract; then widen the cohort.

## Verification labels

On 1 October 2026, the changed Convex functions deployed to
`dev:outgoing-spider-101`; the API, Temporal worker, and execution gateway images
were rebuilt and reloaded without removing the separate simulation worker.
TypeScript completed without errors; focused managed/mobile/binding Node tests
passed 29/29 and focused Python schedule/native/binding/execution tests passed
26/26. The sidecar settlement tests passed 3/3 and the light-console proxy tests
passed 5/5. Runtime health reported Manual Guard and Lite Mode on, live execution
off, and native venue submission off. The new private binding route was absent from
the general agent API and required authentication at the gateway. These prove
local deployment and gate behavior, not an owner-authenticated mobile setup flow,
on-chain/venue submission, or funded account reconciliation. The
older [implementation ledger](implementation-ledger.md) and [Stage 3 checkpoint](stage-03-release.md)
remain available as supporting evidence.

The next unfunded slice adds `/api/mobile/venues/hyperliquid/binding-challenge`
and `/credentials`, which verify the Magic session, wallet, and current Convex
setup attempt before proxying to the execution gateway. The challenge is tied to
the attempt again at credential registration. The key transits the authenticated
Next.js request in memory and is forwarded once to gateway custody; it is never
stored in Convex or returned to the client. This is a code-path qualification,
not a real account binding or permission to submit an order. A separate test of
the key transport and owner signature on the internal tester's account remains.
The separate mobile repository now has typed challenge and registration client
calls. Registration disables automatic session-refresh retry so the API-wallet
secret is sent only on a deliberate request; no customer-facing setup screen
or key generation flow is claimed. Its TypeScript typecheck passed.
The owner-query and mobile bridge tests passed 2/2, the Hyperliquid binding and
native SDK tests passed 16/16, and TypeScript typechecking passed after the
bridge was added. Convex redeployed successfully; the API, workers, and gateway
were rebuilt, followed by a gateway-only rebuild for the corrected 32-byte key
format. Unauthenticated requests returned HTTP 401 at both the mobile bridge
and gateway. The gateway still reports native submission disabled. None of
these checks exercised an authenticated real mobile session or a venue order.

## 1 October follow-on: managed mode and native boundaries

Managed assignments now own an explicit Shadow or Autopilot mode. Manual and
Temporal analysis retain it through the frozen controller and proposal;
legacy assignments remain Shadow. An Autopilot proposal is currently recorded
as blocked because the live financial and execution path is incomplete. The
mobile limits response checks the explicit Autopilot assignment and names the
remaining native reconciliation, reservation, and recovery work.

The Hyperliquid adapter now delegates exact master/subaccount order, cancel,
and perpetual close operations to the native SDK. Gateway health still reports
`live_submission_enabled=false`, and normal proposal execution does not yet
construct an authorized native order. A separate Convex credential channel
requires its own gateway-only secret and returns an encrypted envelope only
for one active owned account, permission, integration, and credential. The
broad analysis-worker secret cannot use it. Gateway credential retrieval has
a validated client contract. Native Hyperliquid dispatch now requires a
matching durable live finance marker before the gateway retrieves that
credential, and the native order must retain the proposal's side, limit
price, notional ceiling, idempotency key, and exact venue account scope.
No product path can yet produce the required live marker, and adapter health
still blocks submission.

The PostgreSQL writer now has a read-only verification seam for an exact live
possible-submission marker and a current complete native account snapshot.
Product paths cannot yet create that marker: native snapshot ingestion, live
bootstrap, sizing receipt, reservation, and submission admission remain
closed. The current Hyperliquid public account read is partial and cannot
satisfy the contract. This is an engineering gap, not a missing funded tester.
An additional exact-address Hyperliquid Info capture now records balances,
default-perp state, orders, fills, funding, and ledger updates with source
times. It remains read-only, non-atomic, incomplete, and outside live finance
storage; its coverage does not establish a reconciled financial snapshot.

Focused managed/mobile/credential Node tests passed 35/35 and focused Python
managed/native/finance/credential tests passed 27/27. TypeScript typechecking
passed. Convex functions deployed to `dev:outgoing-spider-101`; the API,
workers, and gateway were rebuilt and started. Health confirms Manual Guard
on, Lite Mode on, and live submission off. The rebuild exposed a replay
failure in migration 073 when later maintenance-phase receipts already
existed. Its phase constraint now permits those later phases, and a rerun
of the migration service exited 0. No live order, paid provider call, or
funded qualification occurred.

Independent review of the native seam found two latent bypasses: the
submitted coin was not bound to the approved instrument, and the order size
was not bound to the financial reservation. Gateway dispatch now requires the
exact registered Hyperliquid coin, product kind, proposal alias, receipt
action, base quantity, quote price, and notional. A caller-supplied client
order ID is rejected so the venue ID stays derived from the durable
idempotency key. Finance admission reads the stored calculation receipt and
instrument registry, reproduces deterministic sizing, and requires the
distinct `live_native` receipt class. Migration 080 permits that class in the
schema, but no product writer can yet issue it. These checks close a latent
bypass; they do not enable Autopilot or certify a live route.

Migration 081 adds a `dispatching` attempt state. The gateway now atomically
consumes the exact possible-submission marker after credential and financial
checks, before venue I/O. A concurrent retry cannot submit it again. A lost
response remains held for native reconciliation; the live resolution writer
for this state is still missing, so this is not a completed recovery loop.

## 2 October Magic-owner funding qualification

The signed-in mobile journey now uses the exact Magic owner for the managed
mandate. Program confirmation can occur with the amount-and-period action;
submitted vault deployment and funding are checked while the setup screen is
active, and a finalized funding observation advances to the matching native
finance activation. Manual check controls remain for recovery. There is no
background Convex job poller.

An unsigned Particle SDK quote for the internal Magic address confirmed that
the configured Universal Account smart address is the same EVM address, but
also exposed an important mismatch with our earlier fabricated fixture:
Particle v2 omits decoded calls, inner sender, and token sender, uses hex
18-decimal amounts, and may quote the fee in USDC or ETH. The funding validator
and phone review now handle the observed quote shape, cap the fee, require
the owner to cover both committed capital and the selected fee asset at a
finalized block, and stop when the quote expires. A 0.50 USDC unsigned quote
with a placeholder vault address passed these read-only checks; this is not
proof that a real vault funds or that the quoted opaque call set matches the
requested calls independently of Particle. The SDK package is pinned to the
qualified `2.0.0-beta.3` release until its wire format is requalified.

The separate executor factory dry run estimated 2,205,583 gas and a maximum
0.000053225128956 ETH at that quote, with zero ETH currently at the executor
address. Thus no factory or customer vault was deployed, and there was no
Magic signature, capital movement, or live order. Next, the operator must
fund the executor within a reviewed gas envelope, deploy and verify the factory,
enable bounded provisioning, and repeat the quote against the real owned vault
before the tester signs on the phone.
