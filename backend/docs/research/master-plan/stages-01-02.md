# Stages 1–2: ownership, observations, and accounting

These are implementation briefs, not completed work. Consume the [current map](current-system.md), [contracts](contracts-and-state.md), and [Q register](validation-and-gates.md). Existing screens and customer modes remain available throughout. Live flags and development safeguards retain their current defaults.

## Stage 1 — Shared contracts and ownership

**Outcome:** every job, decision, experiment and deployment can identify its account, controller and immutable versions without guessing from a first profile.

**Prerequisites/artifacts consumed:** audited baseline commits; L1–L4/L10; agreed web/mobile ownership; current schemas, team versions and mode normalization. Resolve naming aliases without changing customer authority.

**Deliverables and boundaries:**

- Add `TradingAccount`, `ControllerRef`, immutable `TradingProgramVersion`, `ProgramAssignment`, `ExperimentSpec` identities and compatibility metadata. A program references team/strategy/model/policy versions rather than duplicating their source.
- Extend Convex product records, Python contracts, Temporal payloads, Next API boundaries and mobile response types. Product configuration remains Convex-owned; runtime IDs are stable across projections.
- Route active web deployments by explicit team/deployment; mobile by explicit assignment. Legacy unassigned accounts stay visibly unassigned/paused rather than inheriting an arbitrary team.
- Add actor scopes for customer, researcher, operator and release authority. The future console receives a narrow authenticated backend interface; no direct worker secret or customer impersonation.
- Record runtime compatibility and content hashes. Separate signed direction from nonnegative agreement/confidence; audit proposal clamping and approval completion against deployment mode.
- Update conflicting one-team/mobile documentation while preserving old routes and return shapes through additive fields/adapters.

**Proposed API/type surface:** `ControllerRef = CustomerDeployment | ManagedProgramAssignment`, with environment and optional experiment provenance; `getAccountControllers`; `getProgramAssignment`; `createProgramDraft`; `freezeProgramVersion`; `resolveRunContext`. An experiment references a frozen controller variant in its isolated environment; it is not a third source of live authority. These are specification names, not claims that endpoints exist. Existing `teamId/teamVersionId/deploymentId` fields remain interoperable.

**Bounded custom work/components:** extend current Pydantic/TypeScript contracts and Convex ownership helpers. Reuse Temporal and existing provider routing. No new agent framework or trading engine is needed.

**Migration:** inventory all users/profiles/deployments; generate a dry-run mapping and unresolved list. Backfill only unambiguous links with provenance. Do not silently choose among multiple teams. Version payloads so in-flight Temporal work can finish under its original schema or fail closed with a recoverable migration state.

**Acceptance/failure scenarios (Q1):**

1. Two users, multiple teams and overlapping markets cannot read, approve or control each other's objects; caller-supplied subject IDs cannot bypass authentication.
2. Each of Shadow, Approval and Autopilot preserves its authority through schedule → job → analysis → proposal; manual development guards remain separate.
3. A mobile account with no assignment cannot start a guessed program. Existing read views still work and label missing assignment truthfully.
4. Duplicate create/retry returns stable IDs; edited drafts do not mutate frozen versions. Changed model/policy/configuration changes the frozen hash.
5. An old workflow payload follows its documented adapter; unsupported schema blocks activation rather than losing account/version provenance.
6. A negative directional score remains negative where required; agreement/calibration tests do not reinterpret bearishness as zero support.

**Completion evidence:** migration dry-run report, contract compatibility tests, identity/authority trace for all three modes, explicit unresolved legacy rows and documented behavior. This stage establishes identity, not trading performance or new live capability.

**Rollback:** disable new assignment/program writes; retain additive schema and history. Restore old read adapters without deleting immutable records or reassigning live ownership. No schema rollback may cause active jobs to use first-profile fallback.

**Costs:** local contract tests require no provider calls. Convex deployment, hosted test environments and CI may be billable; estimate and obtain explicit approval before using them. **Still unavailable:** authoritative portfolio risk, complete simulation, managed live mobile release.

## Stage 2 — Trustworthy observations and accounting

**Outcome:** an account's financial state and available risk budget are explainable from immutable evidence; concurrent strategies cannot reserve the same capacity twice.

**Prerequisites/artifacts consumed:** passing Q1, stable account/controller identities, instrument registry draft and reviewed observation/financial contracts. Stage 1 alone cannot attest a real balance.

**Deliverables and boundaries:**

- Native recorded-response ingestion with instrument/venue identity, event/availability/ingestion times, native units, sequence/block/finality, freshness and source rights. Keep raw references/hashes for replay.
- Implement instrument mapping for spot inventory and perpetual contracts separately: multipliers, quote/settlement assets, tick/step/minimums, margin and funding semantics.
- Add ordinary transactional Postgres tables alongside Timescale history for ledger, reservations, reconciliation checkpoints and transactional outbox. Financial service is the single writer; Convex receives product projections.
- Journal fills, fees, gas, funding, deposits, withdrawals, collateral transfers and corrections with dedupe and reversal semantics. Preserve native units using exact decimals; value snapshots carry price provenance.
- Reconcile observed wallet/venue state and journal projections. Missing/stale/inconsistent observations produce unknown/quarantined states, never zero exposure.
- Account-scoped transactional risk reservations include all deployments and withdrawal requests. Use a fencing epoch/lease to prevent stale supervisors from authorizing; Redis alone is not financial authority.
- Build a simple deterministic sizing baseline and policy evaluator. Policy values remain unapproved configuration until Stage 5/7 qualification; do not hardcode conversational examples as production limits.

**Proposed API/type surface:** `MarketObservation`, `InstrumentVersion`, `EvidenceSnapshot`, `AccountRiskSnapshot`, `RiskReservation`; `ingestObservation`, `reconcileAccount`, `reserveIntent`, `releaseReservation`, `readWithdrawableBalance`. Mutations require account/version and stable idempotency keys; reservation output includes expiry and policy/state versions.

**Selected components:** existing Postgres/Timescale, Pydantic and Temporal; prototype selected CCXT public reads only if Q2 beats native-only integration. Optional Pandera/DuckDB remain deferred until measured batch/query needs. No upstream library owns balances or reservations.

**Migration:** add new journal tables; do not reinterpret historical UI totals as audited balances. Bootstrap each real account from timestamped authoritative observations with explicit opening-balance provenance and reconciliation cutover. Historical periods without sufficient evidence stay unknown; do not fabricate trades to balance books.

**Acceptance/failure scenarios (Q2/Q3):**

1. Seed wrong decimals, reused symbols on different venues, late/future observations, duplicates, sequence gaps, stale books and reorgs. Reject/quarantine correctly and reproduce the same accepted snapshot.
2. Hand-calculated spot/perp ledgers cover partial fills, fees in another asset, funding, gas, transfers in transit and cashflow-adjusted P&L without double counting.
3. Concurrent reservations across two teams plus withdrawal cannot exceed account capacity; rollback/crash after commit preserves the reservation and republishes its outbox event once logically.
4. A stale process loses its fencing right; Redis restart does not erase reserved financial capacity. A database outage prevents new authorization.
5. Reordered/duplicate venue events converge to the same ledger; mismatch freezes new risk and shows a reason in product projections.
6. Expired reservations with a possibly submitted order remain held until reconciled; expiry alone cannot make uncertain exposure spendable.

**Completion evidence:** Q2 dataset manifest and rejection results; Q3 arithmetic oracle, concurrency/crash results, ledger-to-observation reconciliation, and measured projection lag. Any unresolved financial discrepancy blocks funded use.

**Rollback:** stop new reservations/ingestion writer; preserve journal and unconfirmed reservations. Reconcile before switching writer epochs or reverting code. Read-only legacy views may continue with explicit stale status; never restore placeholder-zero authorization.

**Costs:** recorded payloads and local databases first. Historical feeds, RPCs, remote storage, infrastructure and data acquisition need separate estimates/approval if metered. **Still unavailable:** qualified live execution, complete protective lifecycle, strategy profitability or production risk limits.
