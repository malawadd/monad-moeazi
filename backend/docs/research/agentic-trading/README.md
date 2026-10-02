# Open source research for Moeazi trading

Research date: 30 September 2026. Scope: evolve the existing trading and agent system for 10–100 accounts. Wallets, configured model providers, customer modes, and product foundations stay in place. This report changes documentation only; recommendations are not installed integrations or live-trading certification.

## Findings and recommendation

Moeazi already has much of the coordination needed to run a trading research service: typed reports, Temporal workflows, model routing, budget reservations, frozen evaluations, and an isolated execution boundary. The strongest opportunity is to connect this foundation to reliable market observations, reproducible strategy experiments, and authoritative account risk. Replacing the app with a generic agent framework would leave those problems unresolved.

**Recommended direction:** retain the current orchestration and Evaluation Lab; prototype CCXT for selected public data, NautilusTrader for event replay, and scikit-learn for quantitative baselines. Evaluate Qlib with RD-Agent as a separate research workbench after the baseline is trustworthy. Prototype CVXPY only for portfolio allocation. Borrow claim-level evaluation patterns from Ragas and validator patterns from Guardrails AI, while making deterministic verification the boundary for trading facts. These are this report's fit judgments, supported and qualified in the linked comparisons.

The research found no drop-in project that completes all six venues, preserves Moeazi's owner-signing boundary, verifies claims, supplies calibrated strategies, and reconciles user portfolios. Those integration responsibilities remain with Moeazi. Useful components exist; their boundaries matter more than their number.

## Read the report

| Document | What it resolves |
| --- | --- |
| [Trading components](trading-components.md) | Data, research, simulation, portfolio optimization, and execution alternatives |
| [Agent components](agent-components.md) | Collaboration, grounding, evaluation, memory, and interoperability alternatives |
| [Integration blueprint](integration-blueprint.md) | How the selected components would exchange data inside the existing system |
| [Validation roadmap](validation-roadmap.md) | Bounded experiments, acceptance criteria, and reasons to reject an integration |
| [Evidence register](evidence-register.md) | Inspected revisions, release and maintenance observations, licenses, and research limits |

Recommendation labels have specific meanings: **adopt** means select for a later scoped implementation; **prototype** means integration fit is unproven; **borrow patterns** means reuse an approach subject to its license; **defer** means no present need; **reject** means reject the stated use, not every use of the project. “Reuse” refers to Moeazi's existing code. Nothing is activated by this report.

## First principles

A complete trading system repeatedly turns a user's mandate into a portfolio action and verifies the outcome. Its economic objective must account for trading costs, risk, capital use, and operating costs. LLM confidence and agreement do not establish expected return.

There are five independent questions:

1. **Observation:** what do we know, from which source, and when could we have known it?
2. **Advantage:** does a reproducible rule have evidence of usefulness after costs against a suitable baseline?
3. **Allocation:** is that opportunity suitable for this account's current portfolio and mandate?
4. **Execution:** can the intended action be submitted, monitored, and recovered correctly?
5. **Learning:** did the realized outcome support the original hypothesis, and should the strategy remain eligible?

An LLM is useful for interpreting documents, proposing hypotheses, requesting calculations, and explaining disagreements. Statistical models estimate relationships; numerical code computes features and allocations; state machines manage orders. Their outputs should be distinguishable and independently testable.

Broad autonomy can develop through an expanding library of approved strategies. Agents may research unfamiliar opportunities, but discovering an idea does not grant permission to deploy it. “Do nothing” is a valid portfolio action. Reliable operation and profitable strategies are separate achievements; this research establishes neither profitability nor execution readiness.

## Capability map and current gaps

Status definitions: **usable** means a relevant implementation exists for reuse, not that production was tested in this review; **incomplete** means important behavior is missing or simplified; **fixture-only** means synthetic Test Center evidence with no product authority; **missing** means not found in the inspected active path, rather than a proof about every file in the repository.

| Capability and purpose | Current status and evidence | Disposition |
| --- | --- | --- |
| Market observation: trustworthy prices, books, funding, events, and account state | **Incomplete.** Read adapters and routing exist; `data_adapters.py` applies a generic HTTP payload and fixed quality score across heterogeneous sources. This is not a validated universal feed. | Reuse storage and lifecycle boundaries; **prototype CCXT public reads**, retain native adapters where required; implement typed normalization and time semantics. |
| Data quality and replay: reconstruct information available at a decision | **Incomplete.** Evidence references and hashes exist. A full venue-specific sequence/gap/finality contract is not established by those fields. | Implement bounded snapshot/feature contracts; **defer Pandera and DuckDB** until batch-data complexity justifies them. |
| Strategy discovery: convert hypotheses into reproducible experiments | **Incomplete.** Customer Research and Evaluation Lab freeze experiments and budget work. No general factor-development loop was found in the inspected product path. | Reuse Lab; **prototype Qlib, then RD-Agent** behind an offline adapter. |
| Quantitative analysis: compute features and forecasts | **Incomplete.** Specialist scores and synthesis exist; they are not a fitted or validated forecasting model. | **Adopt scikit-learn for a future baseline experiment**; keep deterministic features in reviewed Python. **Defer Optuna** until fixed baselines exist. |
| Simulation: estimate plausible executions and costs | **Incomplete.** Evaluation simulates fills using mark/spread/depth and fallback costs. Detailed Shadow/TCA research is **fixture-only**. | **Prototype NautilusTrader replay**; use **Freqtrade as a comparison**, not as a replacement account system. |
| Portfolio allocation: reconcile competing strategies and size positions | **Incomplete.** Proposal size is capped by a simple heuristic. Portfolio-aware sizing research is **fixture-only**. | Implement account-wide reservation and state ownership; **prototype CVXPY** after a simple allocator. |
| Agent collaboration: coordinate work, evidence, and budgets | **Usable foundation.** Specialist fan-out, tier-specific synthesis, typed results, routing, and durable workflows exist. | **Reuse Temporal/Pydantic**; borrow bounded research-loop patterns. **Defer LangGraph/Pydantic AI migration**. |
| Grounding: distinguish verified facts from unsupported text | **Incomplete.** Evaluation has citation checks and a semantic judge, but product and v2 evaluation paths overwrite citations. Source-value and integrity proofs are **fixture-only**. | Repair attribution in a later change; implement claim-level deterministic checks; **borrow Ragas/Guardrails patterns** and evaluate judges independently. |
| Execution: manage actual orders and uncertain outcomes | **Incomplete and gated.** Adapter interfaces and preparation exist; private paths remain blocked. Authoritative risk/reconciliation owners are unavailable. | Preserve gateway/sidecar; build narrow state/journal integration; **borrow Nautilus/Hummingbot lifecycle patterns**. |
| Accounting and outcome memory: trustworthy positions, costs, and learning | **Incomplete.** Evaluation outcomes and scorecards exist; asset conservation, outcome memory, calibration, and promotion research are **fixture-only**. | Extend Timescale history and current projections using observed outcomes; keep memory and promotion non-authorizing until validated. |
| Operations: isolate accounts, recover, and explain decisions | **Usable foundation, incomplete proof.** Temporal, budgets, traces, and safe defaults exist; no 100-account capacity/recovery verification was performed. | Reuse existing controls and OpenTelemetry dependencies; validate queue priority, account isolation, and restart behavior. **Defer MLflow** as a second registry. |

Local sources: [project architecture](../../agent-guide/architecture.md), [agent system](../../agent-guide/agent-system.md), [data adapters](../../../agent-service/src/moeazi_agent/data_adapters.py), [customer research API](../../../agent-service/src/moeazi_agent/customer_research_api.py), and [known gaps](../../agent-guide/known-gaps.md). Specific source observations are recorded below and in the evidence register.

## Local findings that affect the tool choices

**Citation validity is currently an unreliable comparison metric in the inspected v2 path.** `AnalysisOrchestrator._one` replaces the returned evidence list with supplied references. `evaluation_pipeline_v2._run_subject` does the same before `validate_grounding` checks IDs. That can hide fabricated or omitted model citations. Repairing this should precede any claim that a framework improves grounding. Sources: [orchestrator](../../../agent-service/src/moeazi_agent/orchestrator.py), [v2 evaluation](../../../agent-service/src/moeazi_agent/evaluation_pipeline_v2.py), [grounding checks](../../../agent-service/src/moeazi_agent/evaluation_engine.py).

**Current synthesis is not a measured probability model.** Deterministic synthesis weights scores by self-reported confidence; a synthesis draft can replace its consensus, confidence, and scenarios. `proposal_from_synthesis` applies thresholds and a small size/leverage cap. Additional analyst personas cannot substitute for calibration or an account allocator. Sources: [synthesis](../../../agent-service/src/moeazi_agent/synthesis.py), [proposal routing](../../../agent-service/src/moeazi_agent/proposal_routing.py).

**Preserve the evaluation investment.** The Lab already records routes, prompts, evidence, budgets, forecasts, semantic evaluation, and simulated outcomes. Customer Research supplies ownership and preview/start checks. Ragas, Qlib, or RD-Agent should produce artifacts for this system rather than create a competing customer ledger or bypass provider billing. Sources: [agent guide](../../agent-guide/agent-system.md), [evaluation stages](../../../agent-service/src/moeazi_agent/evaluation_pipeline_stages.py), [customer research API](../../../agent-service/src/moeazi_agent/customer_research_api.py).

**Cost attribution needs an explicit oracle before engine comparison.** `simulate_entry` embeds slippage in entry price and reports a separate slippage amount; `settle_fill` also subtracts slippage and an estimated exit cost. This raises a potential double-counting question to resolve with a hand-calculated round trip. It is a source-inspected concern, not a reproduced defect or a performance conclusion. Sources: [entry simulation](../../../agent-service/src/moeazi_agent/evaluation_engine.py), [settlement](../../../agent-service/src/moeazi_agent/evaluation_outcomes.py).

**Execution readiness is not solved by an exchange connector.** `execute_proposal_activity` still supplies zero exposure/loss values and false health/reconciliation flags. Hyperliquid private methods raise certification errors; sidecar signing/broadcast paths remain unavailable. A new framework must not turn these missing owners into defaults. Sources: [workflow](../../../agent-service/src/moeazi_agent/execution_workflow.py), [adapters](../../../agent-service/src/moeazi_agent/venues.py), [sidecar](../../../execution-sidecar/src/server.ts).

## Smallest coherent combination

1. **Keep the foundation:** app, wallets, configured providers, Temporal, Pydantic, Convex current state, Timescale history, and Redis coordination.
2. **Build a trustworthy research path:** corrected attribution, typed observations, deterministic features, scikit-learn baselines, and one replay adapter. Prototype CCXT and Nautilus first where they reduce implementation work.
3. **Add discovery only after measurement works:** Qlib research adapter, followed by an isolated RD-Agent experiment loop with existing model routes and bounded budgets.
4. **Add portfolio optimization only when needed:** a simple account allocator first; CVXPY when competing exposures and constraints make the simpler allocator inadequate.
5. **Retain custom responsibility for authority:** mandates, risk reservations, venue-specific signing, reconciliation evidence, and promotion remain Moeazi-owned.

This sequence is a recommendation, not an assertion that every prototype will pass. The [validation roadmap](validation-roadmap.md) defines stop conditions and a smaller fallback for each one.

## What is established and what remains unknown

This review inspected local code and public upstream documentation, release metadata, licenses, and selected source files. It did not install or execute upstream projects, invoke configured LLMs, collect live market data, run application tests, start services, or submit trades. No integration or strategy has been locally verified by this work.

Important unresolved items are historical data quality/rights, exact venue signing compatibility, operational sizing on available hardware, and evidence that any candidate strategy adds value. These remain explicit research-to-prototype gates rather than reasons to label the whole system complete.
