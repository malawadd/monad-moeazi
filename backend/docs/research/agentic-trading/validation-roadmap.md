# Validation roadmap for the research recommendations

These are proposed follow-up experiments, not results of this review. No upstream package, provider experiment, market probe, deployment, or funded trade was run. The experiments are deliberately small so a candidate can be rejected before it becomes an architectural dependency.

## Order and decision rules

| Priority | Experiment | Decision it enables |
| --- | --- | --- |
| P0 | V0 Grounding measurement and attribution | Whether current and external grounding metrics measure the claims actually made |
| P0 | V1 Typed data adapter contract | Whether CCXT improves the existing ingestion path for selected operations |
| P0 | V2 Replay and cost oracle | Whether Nautilus or a smaller harness can model the intended strategy adequately |
| P1 | V3 Quantitative research adapter | Whether scikit-learn alone is sufficient or Qlib adds useful workflow capability |
| P1 | V4 Bounded agent research loop | Whether RD-Agent or an agent graph adds reproducible research value without bypassing controls |
| P1 | V5 Account allocation | Whether CVXPY improves a simple allocator without weakening exact limits |
| P1 | V6 Order lifecycle and recovery | Whether the existing execution boundary can preserve intent through failure |
| P2 | V7 Agent contribution and strategy evidence | Whether interpretation, debate, or prompt optimization improves held-out/forward outcomes |
| P2 | V8 Scale and operations | Whether the selected combination behaves correctly for 10–100 accounts |

V0–V2 establish the measurement foundation. V3–V5 depend on it; V6 can develop with fake venues in parallel as ordinary future implementation work. V7 needs trustworthy data, costs, and outcomes. V8 tests the resulting architecture, not an empty worker benchmark.

“Pass” below means the scoped acceptance condition passes. It does not mean profitable trading, comprehensive security, or production certification. Numeric fixture sizes are proposed engineering defaults, not statistically sufficient trading samples.

## V0 Grounding measurement and attribution

**Targets:** existing orchestrator/Lab, custom claim verifier, Ragas comparator, selected Guardrails validators. First reproduce the citation overwrite with local fake provider outputs; do not call a real model.

Construct 60 labeled cases, 10 each for fabricated citations, stale/future evidence, wrong instrument/units, numerical contradictions, malicious source instructions, and supported controls. Preserve the supplied set, raw cited set, and independently supporting set. Use simple deterministic source facts so expected results are inspectable.

**Pass:** original citations survive evaluation; every injected deterministic critical violation is rejected; all valid controls pass; semantic judgments are recorded separately from exact checks. Provider parse success cannot turn an unsupported claim into a pass. Store the specific failure, not a repaired citation list.

**Next comparison:** use a separately reviewed textual claim set and confusion matrices for the current semantic evaluator versus Ragas. Count unsafe false accepts, abstention, latency, and cost; do not accept a better average score that hides critical failures. No generic score threshold is assumed to prove truth.

**Reject/fallback:** reject a validator integration that loses claim identity, requires a forbidden hosted dependency, or silently calls a model. Keep explicit Pydantic/Python validation when it is clearer. If semantic evaluators are unreliable, limit model text to research explanations and require structured observed features for strategy inputs.

**Cost:** the fake-output phase uses local computation only. Real semantic comparisons may bill existing LLM providers; cost is unknown until routes, tokens, retries, and dataset size are frozen and approved.

## V1 Typed data adapter contract

**Targets:** CCXT public Hyperliquid and Lighter operations versus existing/native parsers. Use checked-in or explicitly supplied response fixtures initially. Do not invoke private endpoints or infer that a public endpoint is free/unmetered without checking the intended access path.

Cover candles, books, instrument metadata, current funding, and available history independently. Include missing fields, decimal scales, stale snapshots, duplicate IDs, out-of-order updates, incomplete books, unsupported operations, and rate-limit responses. Preserve native instrument and collateral identity.

**Pass:** expected values and units match an independently specified fixture oracle; unsupported data stays unknown; gaps invalidate dependent features; event/receive times are not interchanged; no credentials are loaded for public parsing. A capability flag alone never supplies missing data.

**Reject/fallback:** keep the native adapter for any operation where unified semantics hide information or introduce precision errors. Choose one data owner per venue/operation. Cryptofeed is reconsidered only if a concrete streaming/recovery requirement is unmet and the exact license is accepted.

**Optional extensions:** Pandera must detect batch corruption beyond current checks; DuckDB must reproduce exact snapshot selection without leaking future rows. Neither is needed merely to store more packages in the stack.

**Cost:** local fixtures need no external service. Historical downloads, hosted RPC, vendor subscriptions, and cloud storage require a separate usage/rights and billing assessment.

## V2 Replay and cost oracle

**Targets:** Nautilus research release, Freqtrade comparator, existing evaluation simulator. Freeze an explicitly chosen release and matching docs; recheck source differences from the research SHAs before installation. Keep engines credential-free in a disposable environment.

Use one synthetic instrument and at least 12 hand-calculated scenarios: flat-price round trip, favorable/adverse move, explicit zero fee, fee tiers, funding sign changes, insufficient depth, partial fills, cancellation/fill race, delayed acknowledgement, instrument rounding, and ambiguous candle path. Add venue-specific AMM cases separately; do not reuse a CLOB model for pool execution.

**Pass:** quantities and cash reconcile; each fee/funding/slippage component is counted once; deterministic runs reproduce orders and outcomes; missing costs are unknown rather than silently favorable. Test current entry/settlement slippage attribution directly. The same strategy calculation receives the same chronological observations in each adapter.

Differences caused by documented fill assumptions must be explained in an output comparison, not tuned away. Candle-only input cannot establish queue-level fill accuracy. Inferred reconciliation adjustments must remain distinct from observed fills.

**Reject/fallback:** if Nautilus's release/API transition or adapter burden is excessive, keep a narrowly scoped local replay harness and use Freqtrade only for strategy-level comparisons. No engine passes for live credentials on the strength of a replay result.

**Cost:** synthetic replay is local computation. Actual historical depth data or hosted runners may be billable; no acquisition is authorized here.

## V3 Quantitative research adapter

**Targets:** reviewed deterministic features and a scikit-learn baseline, then Qlib on the same dataset. First compare cash/no-trade, buy-and-hold where meaningful, and a transparent rule-based strategy. A first demonstration may use BTC/ETH hourly data, but that is a tooling default, not a promised strategy advantage.

Freeze data lineage, cutoffs, costs, hypothesis, benchmark, risk budget, and chronological splits before trials. Fit scalers/features on training windows only. Exclude overlapping label periods across train/test boundaries. Record all candidates, including failures, and keep a final holdout inaccessible to the optimization process.

**Pass for the adapter:** Qlib and baseline code reproduce agreed features/labels; crypto units, calendar, funding, and costs are explicit; reruns preserve artifacts. A model can pass these mechanics and still fail the economic test.

**Pass for advancement:** a reviewed protocol finds useful net performance/risk behavior on untouched data relative to the declared baseline, with uncertainty and trial selection accounted for. Sample size, acceptable drawdown, and economic improvement must be chosen for the strategy horizon and user mandate before evaluation; this report does not invent a universal Sharpe target or minimum trade count.

**Reject/fallback:** use scikit-learn plus the existing Lab if Qlib's equity-oriented assumptions or duplicate bookkeeping cost more than the workflow adds. Optuna remains off until fixed baselines and holdouts exist; a later trial budget must be finite and recorded. MLflow is optional only if a linked artifact registry solves a demonstrated problem.

**Cost:** supplied local data and CPU trials need no external service; model/provider-assisted research and rented compute require explicit approval.

## V4 Bounded agent research loop

**Targets:** a simple existing-Python/Temporal workflow, RD-Agent adapter, and optional LangGraph/Pydantic AI comparison. Use stub providers first. Each run has one hypothesis, registered tools, a fixed dataset, a finite experiment budget, and at most one challenger-requested revision.

Inject requests to read secrets, call signing tools, access another account, open an external network connection from generated code, install a package, change a live strategy, and exceed the trial budget. Keep the runner separate from the process coordinating containers; no host Docker socket or production secret mount in generated-code execution.

**Pass:** denied operations are enforced by capabilities, not only prompts; all accepted tool calls retain scope, route, input hashes, usage, and output artifacts; restart does not duplicate paid work by default. Any uncertain provider completion is handled under a bounded retry/billing policy. A graph checkpoint cannot grant production approval.

**Reject/fallback:** reject frameworks that bypass the provider/lifecycle boundary or create ambiguous process ownership. A typed Python workflow remains a valid research agent system. MCP/A2A transports are justified only by an actual second client/service need; external agents get no additional authority.

**Cost:** stub phase is local. A real RD-Agent/TradingAgents/DSPy comparison can make many provider calls; calculate maximum usage per step, retry, and experiment before requesting service-specific approval.

## V5 Account allocation

**Targets:** simple deterministic allocator versus CVXPY with an explicitly open-source solver. Use synthetic authoritative account snapshots and exact unit checks.

Test two strategies sharing collateral, correlated positions, conflicting intents, open-order reservations, unresolved submissions, stale balances, minimum lots, rounding, infeasible constraints, and inaccurate/failed solves. Race two otherwise-valid allocations against the same remaining capacity.

**Pass:** no tested hard limit is violated after venue rounding; only one conflicting reservation succeeds; infeasible/unknown states cannot increase exposure. Solver weights are suggestions until the independent risk check passes. Reservation state survives cache loss through its durable owner.

**Reject/fallback:** retain the simpler allocator if optimization adds little measurable allocation value or depends on fragile expected-return inputs. PyPortfolioOpt remains a research alternative, not a collateral engine.

**Cost:** local computation only for these fixtures. No funded order is part of the experiment.

## V6 Order lifecycle and recovery

**Targets:** existing gateway/sidecar and workflow, using fake venue responses plus applicable Nautilus/Hummingbot lifecycle patterns. Do not unwrap real credentials.

Crash before submit, after submit but before acknowledgement, during partial fill, during cancellation, and after venue completion but before projection. Replay duplicated/out-of-order events; include external account activity, stale approvals, emergency pause, expired delegation, and EVM reorg cases where relevant.

**Pass:** tested uncertain submissions enter reconciliation; no duplicate order effect is emitted by the harness; idempotency survives restarts; one durable owner reconstructs positions and residual orders. Distinguish entry pause, cancel, close, and delegation revoke. Safe risk reduction remains governed and can proceed without a functioning LLM when its authorization and data permit it.

**Reject/fallback:** no live integration if a connector requires exported owner keys, conflicting order ownership, invented fills, or optimistic risk defaults. Missing venue capabilities remain explicitly blocked. Fake-venue success does not certify a native venue.

**Cost:** local fake responses only. Native certification, audits, hosted RPC, gas, fees, and funded tests are separately scoped and separately approved.

## V7 Agent contribution and strategy evidence

**Targets:** quantitative-only baseline; baseline plus grounded text features; baseline plus text and challenger; optional TradingAgents comparator. Hold the available evidence, strategy risk budget, cost model, and model routes constant. Report both matched-budget comparisons and actual operational cost.

Measure claim false-accept rates, forecast calibration, abstention coverage, net returns, drawdown, turnover, execution cost, runtime, and provider usage separately. Remove one role or source family at a time. Retain independent initial responses before debate to detect correlated errors and conformity.

**Pass:** a declared improvement survives held-out or forward evaluation without breaking hard checks and remains useful after the additional operating cost. A null result is useful: remove the unhelpful agent. Never promote from synthetic fixture outcomes.

Historical LLM runs may be contaminated by facts in model training even when prompts contain only historical data. Point-in-time data alone cannot remove that uncertainty. Require prospective frozen forecasts/Shadow observations for claims affected by it. [Relevant primary research](https://arxiv.org/abs/2309.17322).

**Reject/fallback:** explanations may remain useful in the UI even when they add no trading value. Do not force every analyst into the live signal path or call subjective confidence a calibrated probability.

**Cost:** real model and forward data runs may be billable. Use the current preview/reservation machinery with an explicitly approved finite run; no standing authorization is implied.

## V8 Scale and operations

**Targets:** selected stack with 10 and 100 synthetic accounts, at least two strategies sharing collateral in a subset, mocked providers/venues, and representative event/replay workloads. Record hardware, versions, dataset size, and limits before measuring.

Run simultaneous signals, provider timeouts, queue saturation, Redis loss, history-store failure, worker restart, and a reconnect burst. Verify account isolation, bounded memory/concurrency, rate-limit handling, and priority for reconciliation/protective work. Research backlog must not starve order supervision.

**Pass:** no cross-account disclosure or tested risk-limit breach; pending work remains bounded; idle workers produce no Convex job polling; each decision has an inspectable evidence-to-outcome trace. Define latency/throughput service targets from the intended strategy deadline before judging timing results; do not infer production capacity from the account count alone.

**Reject/fallback:** reduce concurrency or research cadence before introducing a new distributed framework. Add infrastructure only when measured contention identifies a specific bottleneck. No broker, GPU cluster, or second database is justified by a hypothetical million-account future.

**Cost:** local mock execution only. Hosted load tests, CI runners, cloud builds, telemetry storage, and deployments require their own cost approval.

## Evidence required before adoption

Every completed prototype should return: exact dependency/solver licenses, pinned versions and artifact hashes, input manifest, commands, outputs, failures, resource usage, comparison against the existing approach, and a written adopt/reject decision. Mark network dependencies and paid-service assumptions explicitly.

The final integration decision must name who owns state and retries. A package that passes its own tests but creates duplicate account, experiment, or order authority fails the fit test. The research report can be complete while a prototype remains unverified; the status must not be silently upgraded.
