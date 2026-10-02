# Stage 4 delivery slice: connected operator journey

This is an implementation checkpoint under [the Stage 4 brief](stages-03-04.md), not a replacement for Q5 or a release certificate. It uses the Stage 3 qualified spot foundation while full Q4 remains open.

## Frozen first journey

An allowlisted operator opens a **separate loopback console**, freezes two existing managed-program versions into distinct Convex experiment specs, prepares a causal-v2 simulation manifest from stored observations through Moeazi's existing backend, registers each run, observes run and portfolio state, requests cancellation, and compares recorded provenance and outcomes. Each variant uses its own `experimentSpecId` and financial scope. A shared dataset hash is required for an A/B label; otherwise the console says the runs are not comparable. The console reports only verified completed native-asset outcomes.

The operator must supply valid frozen versions, stored observation hashes, a strategy rule and explicit economic assumptions. The backend derives model and content hashes; manual manifest input remains available for compatibility. Building a candidate generator, historical dataset curator, automatic strategy selector, and production release button is outside this slice. The final Q5 gate still requires a reproducible end-to-end walkthrough, cancellation/restart, comparison metrics, and auth/isolation evidence; Q4's remaining spot/perpetual/recovery gates stay open.

The current simulation registration requires an already reconciled experiment financial account (`finance_accounts` plus a matching immutable account observation and policy). The bounded authenticated bootstrap route now accepts an internal replay account observation and non-live policy for the owned experiment, reconciles the account, and returns its opening revision. The console carries that revision and the confirmed hashes into run registration. Route tests and typechecks pass; an authenticated SQL-to-console walkthrough has not yet verified the connection. The replay opening balance is simulated capital, never a live deposit.

The isolated simulation Temporal worker is also opt-in and currently unconfigured in the local stack. The next qualification task must wire its dedicated identity credential and queue locally, then prove that a registered run advances while the console is closed. A registration response alone is not an executed experiment.

## Ownership and boundary

- Root owns the authenticated product API bridge, Convex query/mutation additions, shared integration, tests, ledger, deployment, commit and push.
- One Luna XHigh implementer owns only `operator-console/`, a separate local Next/React process and its loopback backend-for-frontend. Its API calls go to the existing web app's authenticated operator endpoints. No worker secret, owner key, venue credential, Convex admin key, or provider key reaches browser code.
- A separate Luna XHigh verifier is invoked at the stable integration checkpoint. It tests the frozen journey and only reports defects that block it or create credible account, authority or financial-state failures.

The console's local server forwards the signed `moeazi_monad_particle_session` cookie only to the configured local Moeazi web origin. The web app verifies identity and an explicit research-operator allowlist, then uses the existing worker credential server-side for simulation endpoints. Convex mutation/query uses the authenticated user's token, preserving `requireProgramActor` and account ownership. Neither browser nor console server may select a worker subject.

## Interfaces in this slice

- Product API: freeze and list owned `experimentSpecs`; strict route allowlist over selected `/v1/simulation` endpoints, including a bounded, read-only catalog of already admitted native observation metadata.
- Console: variant A/B freeze form, admitted-observation lookup, manifest submission, run/portfolio reads, explicit cancel, hash/provenance comparison, and clear unknown/incomparable states.
- Existing Convex `freezeExperimentSpec`, backend `register_run`, `control_run`, `read_run`, and `read_simulation_portfolio` remain authoritative. This slice adds no second job store or financial journal.

## Done for this slice

Local typecheck/build and focused auth/route tests pass. A connected local walkthrough records real Convex and backend IDs and proves refresh does not create a duplicate. If current dev account/operator configuration prevents the walkthrough, the precise missing prerequisite is recorded and the slice is not labeled Q5 pass. Existing product interfaces remain available. No external provider or funded trade is needed.

## Scope and cost discipline

Freeze this journey before extras. Fix only blockers to the journey or credible funds/authority/accounting defects. Two bounded repair rounds, then document/escalate the blocker; do not grow an edge-case backlog during this slice. Local tests are preferred. Any newly billable operation follows the workspace cost rule's action-specific approval requirement.

The current narrow task is a backend-owned outcome read for an owned, completed run.
It may report only values derivable from persisted financial records; unavailable
cashflow, P&L or return is `unknown`. The console must not rank variants on
registration, shared dataset identity or a partial portfolio page. This is a
main-path comparison prerequisite, not permission to broaden simulation semantics.
