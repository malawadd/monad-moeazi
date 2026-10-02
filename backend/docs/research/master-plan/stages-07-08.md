# Stages 7–8: managed mobile releases and operational expansion

## Stage 7 — Managed mobile program and controlled releases

**Outcome:** an eligible customer can authorize an explicit Moeazi-managed version, fund its supported account path, start trading within the qualified mandate, observe truthful results, stop and withdraw. Operators can release improvements without abandoning open positions.

**Prerequisites/artifacts consumed:** Q1–Q10 required gates passing; at least one qualified strategy and native lifecycle; approved policy/eligibility/consent envelope; secret/permission readiness; explicit account assignment and release artifacts. An engine prototype or strategy research completion alone is insufficient.

**Deliverables and boundaries:**

- Add immutable release packages binding program/team, strategy, model, policy, instrument, execution adapter and certificate versions; link exact qualifying experiments. Approval is a separately authorized backend command.
- Implement assignment per mobile trading account, enrollment eligibility, consent envelope and readiness reasons. Remove first-profile inference only through a compatibility migration, preserving current screens and routes.
- Connect actual deposit/finality, account activation, native grant and collateral readiness to start eligibility. Funding a wallet and enabling trading authority remain distinct.
- Define and implement customer controls for pause/new-entry stop, close-and-stop and withdraw; product must clearly state the selected default. Maintain protection after analyses stop.
- Replace fixed market/timing text and optimistic status summaries with backend-owned projections. Reports distinguish signal, proposal, submitted order, observed fill, realized/unrealized result, fees and cashflows. Uncertain and stale states remain visible.
- Add operator release review, staged enrollment, rollback and migration views to the console. A research operator cannot self-approve production release; automated discovery cannot grant itself authority.
- Keep each existing position tied to its opening program, policy and supervisor compatibility version. New entries may use a new version only after a tested compatibility/migration decision.

**Proposed API/type surface:** `ProgramRelease`, `ProgramAssignment`, `EnrollmentConsent`, `AccountReadiness`, `PositionMigrationPlan`, `StopRequest`, `WithdrawalPlan`; `previewEnrollment`, `authorizeProgram`, `startAssignment`, `requestStop`, `previewWithdrawal`, `requestProgramRelease`, `approveProgramRelease`, `rollBackRelease`. Actual routing follows existing authenticated Convex/Next/mobile boundaries.

**Selected components/custom work:** reuse mobile wallet/funding/withdrawal modules and receipt verification; extend assignment/readiness/reporting. Use shared Stage 2/3/6 accounting and execution; no mobile-specific trading engine. Release service owns compatibility and authorization, with Temporal for durable transitions.

**Migration:** inventory existing mobile profiles; offer explicit assignment/consent when required. Backfill only provable relationships. New policy powers outside an existing consent envelope require renewed consent, not an invisible release. Existing web teams retain their modes and ownership.

**Acceptance/failure scenarios (Q11):**

1. New account with no funds/grant/certificate shows the exact missing prerequisite; start never treats activation alone as trading permission.
2. Deposit observed late, grant revoked, funding quote expired or account snapshot stale cannot enable trading. Duplicate start/stop requests are idempotent.
3. Full qualified journey covers enrollment → funding → start → observed trade/protection → stop → unwind/settlement → withdrawal. Product results match the authoritative journal.
4. Program upgrade with an open position either retains its compatible old supervisor, executes an explicit migration or drains first. It cannot reinterpret old exposure under new sizing or lose protective orders.
5. Rollback stops new-version entries, preserves positions/history and retains compatible protection; it does not rewind fills or financial state.
6. Withdrawal racing with a trade reservation cannot overspend. Insufficient liquidity, owner interaction, unsettled collateral and failed transfer remain explicit pending/failed states.
7. Customer/research identities cannot release a program; revoked operator privileges take effect at command execution. Audit records identify actor and release evidence.
8. UI labels, report arithmetic and cashflow-adjusted performance remain truthful in partial-fill, uncertain-submit and no-trade periods. Education text cannot promise a safe return.

**Completion evidence:** release and migration rehearsal; mobile journey traces; report/ledger comparison; operator authority tests; approved first cohort, policy and stop semantics. Initial enrollment must remain within demonstrated capacity and venue certificates.

**Rollback:** freeze enrollment and new entries for the affected release; retain legacy UI and compatible supervisors, reconcile and apply documented position-aware migration. Revoking a program is not automatically permission to transfer customer funds to a new destination.

**Costs:** mobile distribution, deployment, on-ramp quotes, funded end-to-end tests, infrastructure and provider usage may be billable. Each needs a specific estimate/approval when applicable. **Still unavailable:** expansion beyond measured capacity, unsupported venue/instrument combinations, automatic research-to-production promotion.

## Stage 8 — Operational expansion to 10–100 accounts

**Outcome:** account isolation, recovery, capacity and operating cost are demonstrated at the intended range, and improvement remains evidence-driven rather than self-modifying live trading.

**Prerequisites/artifacts consumed:** Stage 7 release gate; Q1–Q11 evidence and runbooks; declared SLOs, account workload assumptions, provider/venue quotas, operational budget and rollout policy. No invented throughput/latency target substitutes for measuring the existing infrastructure.

**Deliverables and boundaries:**

- Instrument account supervisor age, reconciliation lag, stale observations, uncertain orders, protection gaps, reservation age, database contention, provider budget use and experiment queue depth. Reuse existing telemetry; add OpenTelemetry only where propagation/export gaps are demonstrated.
- Separate research and protection worker pools/queues/resource budgets. Prioritize reconciliation and protective actions during overload; throttle research and new entries first.
- Share public market data and immutable generic research artifacts where valid; account state, sizing, consent, risk and executions stay isolated. Version/key shared outputs by data cutoff and configuration.
- Run synthetic/replay workloads at 10, 50 and 100 accounts with multiple teams, not paid live orders or model calls. Include bursts, venue limits, duplicate events and noisy-neighbor experiments.
- Rehearse database restore/outbox replay, Temporal worker loss, Redis loss, signer isolation, venue outage and operator response. Restore requires current reconciliation before new risk.
- Add post-release deterioration monitoring, drift and cost attribution; proposed improvements re-enter frozen experiments and controlled release. No autonomous parameter mutation or agent memory directly changes active policy.
- Measure resource drivers and produce a budget model for observed data volume, account checks, analysis cadence, model mix, venue/RPC usage and retention. Pin runtime/container/dependency versions instead of broad `latest` where introduced into qualified paths.

**Proposed API/type surface:** `AccountHealth`, `OperationalReadinessReport`, `IncidentRecord`, `CapacityEnvelope`, `StrategyReviewTrigger`; health summaries reference authoritative event age and source, not just process liveness. Telemetry must omit credentials and hidden chain-of-thought.

**Selected components/custom work:** existing Temporal/Postgres/Redis/Convex ownership; existing telemetry plus optional OTel exporters. Add only measured queue/connection/admission-control gaps. Do not add Kubernetes, another orchestrator or vector database merely for account count.

**Migration:** progressively enable cohorts within demonstrated capacity. Existing position owners remain stable through worker partitioning; fenced account ownership prevents split-brain supervision. Archive/retention policies preserve audit/replay requirements and data-use rights.

**Acceptance/failure scenarios (Q12):**

1. At each target load, declared SLOs and protection/reconciliation priority hold; measure p50/p95/p99, queue age, errors and resource use. Freeze thresholds before certification runs.
2. One account's runaway agent, provider failure or rejected orders cannot exhaust another account's risk budget or credentials. Cross-tenant evidence/cache keys remain isolated.
3. Worker failover and DB restore do not double-submit or double-post; uncertain orders remain reserved until reconciled. Redis loss cannot unlock spendable capacity.
4. Venue outage, stale data and rate limits produce controlled backoff/quarantine, not request storms. Protection limitations are surfaced and escalated.
5. Model/provider outages or zero AI budget do not stop required protective work; research backpressure cannot starve the account supervisor.
6. A drift trigger creates a review/experiment, not an unapproved release. Rollback rehearsals preserve ledger and open-position ownership.

**Completion evidence:** Q12 load/recovery report, measured capacity and cost envelope, incident/restore drills, rollout record and residual limits. Simulated-load success does not prove venue rate capacity under funded production conditions; report both separately.

**Rollback:** reduce cohort/concurrency and disable new enrollment/entries as needed; preserve protective supervision and journal. Revert telemetry or research additions without losing account ownership. **Costs:** local replay first; cloud load tests, metrics retention and production validation need estimates/approval. **Still unavailable:** any capability outside its current certificate, demonstrated capacity or customer mandate.
