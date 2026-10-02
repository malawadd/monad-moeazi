# Stages 3–4: trading lifecycle and connected experiments

## Stage 3 — Complete trading lifecycle in simulation

**Outcome:** the actual backend can take a versioned strategy intent through sizing, risk, simulated orders, fills, protection, closure and crash recovery. A complete simulated lifecycle is required before a console can report meaningful strategy results.

**Prerequisites/artifacts consumed:** Q1–Q3 passing; instrument/evidence manifests; financial journal and reservations; mode contracts. Existing quote-based Shadow records are historical illustrative observations, not reconstructed fill histories.

**Deliverables and boundaries:**

- Add a strategy interface consuming frozen observations and emitting `TradeIntent` with horizon, rationale/claims, target exposure and invalidation conditions. Keep calculations in deterministic tools; an agent may abstain.
- Add adapters for recorded replay, forward shadow, approval and live-capable transport around the same intent/risk/order contracts. This stage enables only non-live adapters.
- Implement account-scoped durable supervisor, order journal and protection state machine. Analysis may fail or stop while the supervisor continues managing existing exposure.
- Handle partial fills, cancel races, reduce-only closures, rejected protection, funding, liquidation/margin observations and stale-market policies. Distinguish intended protection from confirmed protective orders.
- Make uncertain submission a persistent state, not success. Maintain reservation, reconcile by stable identity, and quarantine unresolved exposure. Remove unconditional success transitions from the eventual active lifecycle path.
- Separate strategy status from order/position status; execution results include simulation provenance. No simulated fill can set a live portfolio projection.
- Implement a small hand-calculated simulator oracle. Qualify Nautilus behind replay contracts; use Freqtrade as a bounded candle comparator where appropriate. Do not maintain two independent live order owners.

**Proposed API/type surface:** `TradeIntent`, `ExecutionPermit`, `ExecutionEvent`, `PositionProtectionState`, `ReconciliationResult`; `submitIntent`, `observeExecution`, `requestCancel`, `requestClose`, `reconcileUnknown`, `readPositionProtection`. Live transport is unavailable until Q10 certification. An account fencing epoch and stable order key travel with every command.

**Selected components/custom work:** Temporal for durable coordination; existing gateway/sidecar interfaces; Postgres ledger; bounded custom strategy adapter, lifecycle reducer and account supervisor. Nautilus is a Q4 prototype, not a prerequisite if its integration fails. Use tested patterns from Hummingbot without importing its credentials/runtime.

**Migration:** route opted-in non-live experiments through the new lifecycle; retain old Shadow history with its original semantics and clear labels. Existing live flags remain off. Schema-version new Temporal workflows; do not replay old histories through incompatible workflow logic.

**Acceptance/failure scenarios (Q4):**

1. Spot buy/sell and perp open/increase/reduce/close reconcile to hand-calculated fees, funding, inventory and equity; cost terms are not counted twice.
2. Partial entry followed by process crash recovers exposure and protection; parent cancellation does not silently leave an unprotected fill.
3. Lost acknowledgement before/after venue acceptance produces no blind resend. Duplicate/reordered fills are applied once; restart converges without fabricated certainty.
4. Analysis outage, empty AI credits, research cancellation and closed console do not stop the supervisor. Missing gas/operational capacity triggers its separate policy.
5. Stop-new-entry blocks fresh exposure while permitted protective actions continue. Account-wide pause/kill and revocation have testable precedence.
6. Identical frozen input produces identical deterministic replay results; stochastic components record seed and tolerances. Unsupported book/AMM mechanics are labeled and block claims requiring them.
7. A live-like event cannot escape a simulation namespace or invoke signer/venue transport; development guards are independently enforced.

**Completion evidence:** replay manifest, event/journal timeline, arithmetic oracle, fault-injection results and engine comparison/rejection record. Protection is proven only under tested simulated assumptions at this stage.

**Rollback:** disable new lifecycle entries; drain or resume existing simulated workflows on compatible code. Preserve event histories and reservations; never replace uncertain results with terminal success. **Costs:** local recorded replay first; no provider or venue usage required. **Still unavailable:** funded trading, venue-certified protection, production strategy claims.

## Stage 4 — Connected experiments and separate operator console

**Outcome:** an operator can create an isolated mobile-program candidate experiment in a separate local UI, run it through Moeazi's real backend, and compare reproducible results.

**Prerequisites/artifacts consumed:** Q1–Q4 passing for executable experiments; backend-owned program drafts and simulated accounts; current Evaluation v2 preview/freeze/budget flows and Test Center access boundaries. Read-only console views may be delivered earlier but do not satisfy this gate.

**Deliverables and boundaries:**

- Build a local TypeScript/React console using repository-compatible dependencies. Its backend-for-frontend verifies operator identity and scopes; no browser storage of worker secrets, owner keys or exchange credentials.
- Extend existing evaluation APIs/storage/Temporal activities for `ExperimentSpec`: immutable program variants, data cutoffs, scenario manifest, simulation model/cost assumptions, budget, seed and output artifact hashes.
- Isolate experiment portfolios and jobs by namespace; use Stage 3 lifecycle/risk contracts with simulated financial state. Research workers cannot promote their own outcomes into live balances.
- Add candidate clone/freeze, preview, run/cancel, timeline, comparison and decision-evidence views. Display actual configured mobile assignment or explicitly state it is absent.
- Compare A/B variants on the same data/conditions and record failed/cancelled runs. Reuse common random seeds where appropriate; reserve a separate untouched holdout for Stage 5.
- Keep existing customer research, Evaluation Lab and Test Center. Add a narrow synthetic-scenario bridge without granting its process new external capabilities.
- Implement optional immutable HTML/JSON exports. Evaluate Hummingbot patterns against this view; defer MLflow/Optuna services until their added value passes Q5/Q6.

**Proposed API/type surface:** `POST /operator/experiments/preview`, `POST /operator/experiments`, `GET /operator/experiments/{id}`, `POST /operator/experiments/{id}/cancel`, `GET /operator/comparisons`, `GET /operator/programs/{id}`; endpoint names are proposed. Use signed authenticated sessions, idempotent creation, bounded cursors/event progress, and server-side scopes. No production-release mutation is enabled yet.

**Selected components/custom work:** reuse Lab planning/reservation/price/provider routing; add program experiment adapter, operator authorization and thin UI. Optional MLflow link uses Moeazi experiment ID as canonical and cannot activate a program. No second SQLite backend or Hummingbot credential store.

**Migration:** additive operator routes and experiment kinds. Preserve old evaluation outputs and their provenance; do not relabel analytical scoring as full trading simulation. Existing URLs remain valid.

**Acceptance/failure scenarios (Q5):**

1. Create, freeze and run two variants from the console; backend stores real IDs/results and reproduces a selected result from hashes. Refresh/reopen resumes observation rather than creating another run.
2. Network disconnect, repeated submit/cancel, worker restart and browser closure preserve budget accounting and job state; cancellation cannot become a position-close command.
3. A customer session cannot call operator APIs; a research operator cannot release programs. Caller-supplied account/user IDs are checked against verified identity and scope.
4. Fixtures, replay, shadow and live observations remain visibly distinct. Missing data shows unknown, not invented performance.
5. The same frozen strategy produces equivalent results through direct backend invocation and console-created execution; no UI-only calculator is authoritative.
6. An experiment cannot change production assignments, account journal rows or live authority. Cross-experiment reads/writes are tested.
7. Hummingbot/MLflow comparison records the reusable value, added state and rejection reason even if no external subsystem is selected.

**Completion evidence:** connected experiment and comparison walkthrough against a local backend, auth/isolation tests, cancellation/restart trace, budget settlement and export round-trip. A static mockup is insufficient.

**Rollback:** disable operator mutations or serve read-only; durable backend jobs continue or cancel explicitly. Keep existing product interfaces and experiments. **Costs:** local fixtures/replay first; any model-backed run must preview the named provider, expected cost/usage, and receive specific approval. **Still unavailable:** production release authority, qualified mobile live trading, proven strategy value.
