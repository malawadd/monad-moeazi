# Stage 3 progress — maintenance closure qualification

Continuation of [the second progress record](stage-03-progress-02.md).
The [implementation ledger](implementation-ledger.md) remains the stage index.

## Checkpoint: scoped close attempts

Stage 3 and Q4 remain unaccepted. Stages 1–2 are published; all Stage 3
implementation remains local. The application database and runtime have not
received these Stage 3 changes. This record distinguishes disposable PostgreSQL
qualification from deployed product behavior and funded venue evidence.

SQL076 SHA-256
`19925b3345639955a82dff9ccd7401ac3c9a6c836afba178a8b5a6b877ec79f6`
was reviewed and applied twice successfully to `moeazi_q4_20260930` only.
It binds each maintenance mandate to the current account authority epoch,
reservation, command-specific sizing receipt, and dedicated intent marker.
A submitted maintenance order must carry that exact mandate and authority epoch.
A subsequent attempt requires every earlier attempt on the same position to have
a terminal source event, financial fold and SQL072 reservation disposition.

SQL072's underlying guard binds terminal event, order, permit, cumulative quantity,
event fold, hold disposition and the current reconciliation checkpoint. These
structural checks are prerequisites; they do not establish that the complete
maintenance writer or successful closure already works.

Typed maintenance consumes an authenticated, applied owner `request_close`.
It does not manufacture a strategy draft, ordinary approval, or broader trading
permission. A stopped account can reduce exposure only with clean reconciliation
and a current authority epoch. Original protection obligations remain historical
records; distinct attempt orders preserve rejection, partial-fill and recovery
lineage. Acceptance of a close request does not prove a flat position.

## Work and gates

- Backend owns atomic maintenance sizing, intent, reservation and mandate issuance.
- Product owns exact mandate checks at preparation/submission and causal source math.
- Supervisor owns durable advance integration and migration/stage acceptance.
- Independent verifier owns adversarial checks and source-backed closure evidence.

Required next evidence: actual restricted-role spot close, partial/rejected retry,
authority changes, source-backed flat resolution and crash recovery. Perpetual
admission, retained funding budgets and complete lifecycle qualification remain
open. No Stage 3 deployment, paid provider call or financial transaction occurred
at this checkpoint. Three final system-validation cycles remain pending.

## Durable selection and current evidence

SQL077 SHA-256
`b364c4d7d6b6c3dc34ff320916142d07baae926a9f3dc28e8a5611f591a2ec26`
was independently reviewed and applied twice only to disposable Q4. It adds
maintenance selection/execution phases to the existing immutable phase receipts.
The actual restricted-role selection test passes: actorless historical controls
are excluded, a prior no-op does not consume a later owner request, exact retries
retain the selected command, and changed retry inputs are rejected. Combined with
existing settlement-response recovery and actor tests, **3/3 pass in 9.96s**.
Selection alone creates no reservation or execution authority.

The deterministic maintenance decision helper discovers stored evidence from the
current frozen prefix and binds it to the current account snapshot. It requires
no research worker, strategy callback or model provider. Equally recent evidence
snapshots or conflicting latest books fail closed. The actual restricted-role
registration/idempotence/no-extra-hold/stale-abstention test passed **1/1 in 2.22s**;
the subsequent explicit ambiguity guard still needs its own adversarial test.

SQL078 SHA-256
`7d35cdf1b39385ab8993b9b31a0ec72b08712d3e24b3b3ff01ac8df7fd36b550`
was reviewed and applied twice only to disposable Q4 after confirming zero
existing maintenance mandates. It adds immutable order-number allocations shared
by entries and maintenance, preserving historical preparations and order IDs.
The application deployment must also verify that no intermediate-schema mandates
exist before applying its non-null column requirement; no history is rewritten.
Writer integration, concurrency tests and startup-role inventory checks remain
required before acceptance.

Independent review identified a recovery gap: an expired never-submitted hold
can be released through the existing financial owner, but its old maintenance
mandate still prevents a later attempt. A distinct no-submission abandonment proof
is required; it must not manufacture a terminal venue event or flat-position claim.
Submitted or uncertain attempts remain fenced. Recovery of legacy protective
orders whose original obligations already changed status is also still a gate.
