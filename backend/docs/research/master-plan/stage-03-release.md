# Stage 3 foundation checkpoint

The user requested an immediate scope freeze on 2026-09-30 after Stage 3 expanded
too far into edge cases. This checkpoint publishes the working simulated spot
foundation and moves remaining qualification into an explicit follow-up backlog.
It does **not** declare the original complete Q4 gate passed.

The Stage 3 implementation was published to the designated main branch and
verified. Mobile source was unchanged.

## Working path

An isolated experimental account can take a deterministic strategy through current
evidence, exact sizing, an account-wide reservation, simulated submission, source
fills, a reconciled journal/checkpoint, and settlement. An authenticated owner close
request can then run through the normal durable worker loop, produce a separately
authorized reduction, reconcile its fill, settle the close hold and prove flatness.

Both direct and normal-worker spot-close tests pass. The worker test calls only
the owner control and `advance_run` after entry; it does not manually issue, submit
or resolve the close. Exact command retries retain the original economic identity.
The independent verifier also ran the connected direct spot path successfully.

Existing product interfaces, wallets, configured providers and customer modes stay
available. Simulation is explicitly experimental; no signer or live execution
authority is introduced. The dedicated simulation worker remains opt-in.

## Release checks and deployment

- TypeScript tests: **290 passed**.
- TypeScript compilation and production web build: passed.
- Direct and worker spot-close integration: **2 passed**.
- Independent pure Stage 3 contracts/economics/causal tests: **133 passed**.
- Independent shared-order allocation and restricted-role checks: **21 passed**.
- Final independent Stage 3/lifecycle regression: **307 passed, 17 skipped** in
  197.23 seconds. Process/Temporal opt-ins were not enabled for this final run;
  earlier individual recovery evidence remains separately labeled.

Convex functions deployed successfully to the authorized development deployment,
`dev:outgoing-spider-101`. Local API, gateway and Test Center images were rebuilt.
Application migrations **058–079** applied successfully after a local full database
backup. Ordinary application access and Timescale job ownership remain with
`postgres`; SQL064's reviewed extension version is 2.28.2. The new runtime tables
are present. No customer simulation records were seeded into the application DB.
After restart, API and gateway health returned HTTP 200; the deployed API exposes
all 10 simulation routes and imports the new maintenance writer/dispatch code.
The dedicated Convex simulation identity endpoint remains unavailable (HTTP 503)
because its separate credential is not configured; the optional simulation worker
was not enabled. This is a deployed foundation with local connected qualification,
not a claim that application accounts are now running automated simulation.

The SQL079 correction fixes a PL/pgSQL table alias that conflicted with the trigger
`OLD` record. Its SHA-256 is
`376323a8331bb3e7f49db82d1a5e5d76d28d98818946252636c2d941a3aaeaef`.
Earlier exact migration hashes and bounded evidence remain in the linked progress
records. No earlier failed static review is relabeled as successful execution.

## Deferred requirements

| Requirement | Disposition |
| --- | --- |
| Perpetual financial admission, complete close and causal funding budgets | Remain gated; pure math/source work does not qualify the SQL lifecycle |
| Recovery after authority changes on a never-submitted maintenance reservation | Safe expiry release exists; mandate abandonment/reissue remains incomplete |
| Recovery of older protective attempts that changed original obligation status | Separate compatibility qualification remains open |
| Full close retry/fault matrix and OS restart during closure | Not established by the two main-path tests |
| Full Q4 economic corpus, customer-mode matrix and independent worker qualification | Follow-up qualification; preserve individual passing evidence |
| Native execution, funded qualification, managed mobile release and three final cycles | Later mandatory gates remain unchanged |

These limitations prevent a production-autopilot or full-Q4 completion claim. They
do not justify further scope expansion before publishing this requested checkpoint.
Stage 4 work may consume the qualified experimental spot path, but must not assume
the deferred capabilities exist or permit native execution because this code ships.

## Recovery and continuity

Keep live execution and mainnet setup off, with Manual Guard and Lite Mode on.
Disable new simulation admissions if rollback is needed; preserve the append-only
journal, source events, commands and holds. Never restore a backup over active
financial history merely to revert application code.

See the [ledger](implementation-ledger.md), [independent review](stage-03-independent-verification.md),
and progress records [one](stage-03-progress.md), [two](stage-03-progress-02.md),
[three](stage-03-progress-03.md). The continuous goal remains unfinished.
