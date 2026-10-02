# Agent collaboration and grounding components

Research date: 30 September 2026. **D** indicates documented capability; **S** indicates selected source inspection. No external agent framework was executed. Recommendations preserve the existing model providers, routing, budgets, and secret boundaries.

## Collaboration frameworks

| Project and license | Evidence and actual contribution | Recommendation for Moeazi | Validation |
| --- | --- | --- | --- |
| [Temporal](https://github.com/temporalio/temporal), MIT | **D/local S.** Durable workflow coordination is already integrated in Moeazi. | **Reuse.** Own schedules, retries, approval waits, experiment lifecycle, and recovery. Keep external calls in activities and respect idempotency; durability does not make venue effects exactly once. | V6: crash and resume without duplicate proposal or submission effects. |
| [LangGraph](https://github.com/langchain-ai/langgraph), MIT | **D/S.** Explicit state graphs; inspected `compile` accepts checkpointing and interruption options. | **Defer migration; prototype only if a bounded research graph becomes materially easier to maintain.** If used, keep graph-local checkpoints separate from Temporal's process authority. OSS library does not require a hosted LangSmith service. | V4/V6: identical artifacts, bounded steps, and unambiguous resume ownership versus current Python orchestration. |
| [Pydantic AI](https://github.com/pydantic/pydantic-ai), MIT | **D.** Typed agent outputs, tools, and model integrations. | **Defer.** Current Pydantic contracts and provider adapters already cover much of the first need. New wrappers must preserve route identity, provider usage, lifecycle checks, and retries. | V4: stub provider contract parity before any paid comparison. |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents), Apache-2.0 | **D/S.** Analyst/research/trader roles, graph orchestration, checkpoint and memory integration; project describes a research framework. | **Borrow patterns and use as an experimental comparator.** Do not import its trader/portfolio-manager decisions as production authority. Its data/model backend and persistence need adaptation to the app. | V7: same frozen inputs, configured providers, budgets, and labels as Moeazi; measure marginal value of debate. |
| [RD-Agent](https://github.com/microsoft/RD-Agent), MIT | **D/S.** Factor/model experimentation and code-producing research loops. | **Prototype a research worker**, after Qlib/data validation. It has a clearer measurable artifact than unconstrained analyst conversation. | V4: denied capabilities and reproducible experiments; see [trading comparison](trading-components.md). |
| [DSPy](https://github.com/stanfordnlp/dspy), MIT | **D.** Programming and optimizing LM pipelines against examples/metrics. | **Defer.** Useful after a trusted labeled evaluation set exists. Optimizing prompts against a weak judge can optimize the wrong behavior; provider usage must be budgeted. | V7 extension: held-out claim quality improves without more unsafe false accepts or excessive provider cost. |

LangGraph's [inspected state builder](https://github.com/langchain-ai/langgraph/blob/07b33185eab893be2ed031eedae52f09314bf77c/libs/langgraph/langgraph/graph/state.py) supports checkpoint and interrupt configuration. This proves an API exists, not that nested Temporal/LangGraph retries are safe. TradingAgents' [inspected graph](https://github.com/TauricResearch/TradingAgents/blob/8b22d43d01d9ddda5d686d093d5385884622f3de/tradingagents/graph/trading_graph.py) constructs model clients and uses its own configuration, result paths, checkpointing, and memory. Integration must account for those responsibilities rather than just calling `propagate` inside a worker.

These libraries have modest orchestration overhead compared with their model calls, but no CPU, latency, token, or account-capacity benchmark was performed here. At this scale, duplicate lifecycle ownership and repeated LLM calls are more immediate design concerns than distributed agent infrastructure. This is an engineering judgment to test in V8.

## Grounding is several different problems

“Ground the model” needs a more precise contract than “add RAG.” Separate:

| Problem | Appropriate mechanism | What it does not establish |
| --- | --- | --- |
| Find relevant information | Filtered SQL/text retrieval; optional vector search | Source truth or timely availability |
| Enforce output shape | Existing Pydantic schemas and provider structured output | Factual correctness |
| Verify numbers and identities | Typed source fields, instrument registry, deterministic calculations | Future profitability |
| Check textual support | Claim-to-passage review; evaluated semantic judge | That a false source became true, or that the judge is infallible |
| Estimate forecast reliability | Held-out and forward outcomes, calibration, abstention | Guaranteed coverage under market change |
| Limit consequences | Deterministic policy, allocation, and execution boundaries | Elimination of every operational failure |

The immediate custom component is a **claim verifier** operating on immutable evidence and calculation receipts. Off-the-shelf validators can make this easier to implement; they cannot define Moeazi's market semantics.

### Ragas

**Borrow patterns; prototype as a second offline evaluator.** Apache-2.0. The faithfulness approach decomposes answers into claims and checks support in retrieved context. Inspection of `_faithfulness.py` found typed statement-generation prompts and model-based metric machinery. [Project](https://github.com/vibrantlabsai/ragas), [faithfulness documentation](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/faithfulness/), [source](https://github.com/vibrantlabsai/ragas/blob/main/src/ragas/metrics/_faithfulness.py).

This helps measure support, not market truth. Moeazi already has a semantic grounding evaluator, so compare against it rather than replacing it automatically. Use the current provider boundary, not the package's example client setup. Some metrics and test generation invoke models/embeddings and may incur charges. The current repository metadata observed in this review showed no push after February 2026; verify the intended maintained version before integration.

**V0/V7:** compare both judges against human-reviewed numeric, temporal, entity, and textual claims. Measure false acceptance separately from false rejection. Do not allow a high average faithfulness score to override a failed critical claim. Medium evaluation-adapter effort; no additional serving model is selected by this report.

### Guardrails AI and NeMo Guardrails

**Borrow Guardrails AI validator patterns; defer NeMo.** [Guardrails AI](https://github.com/guardrails-ai/guardrails), Apache-2.0, composes input/output validators. It is useful for organizing checks, but existing Pydantic and explicit Python functions can implement the first domain rules. Individual Hub validators can have their own dependencies, model usage, or service requirements; the core license is not a blanket approval for every plugin.

[NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails) provides programmable conversational controls. Its [current license file](https://github.com/NVIDIA-NeMo/Guardrails/blob/develop/LICENSE.md) identifies Apache-2.0, despite GitHub's metadata returning `NOASSERTION`. It can become relevant for a conversational trading assistant, but it adds little to exact price, fee, or collateral verification. Any additional models or hosted integrations require separate selection. **V0** can compare specific validators; neither framework becomes an execution authority.

### Retrieval and memory

**Reuse PostgreSQL/Timescale retrieval first; defer [pgvector](https://github.com/pgvector/pgvector).** pgvector uses the PostgreSQL license and offers vector search within PostgreSQL. It would avoid a separate vector service if semantic retrieval later helps. Embeddings still require a separately chosen computation path, and tenant/time filters must apply before evidence is exposed to a model. [License](https://github.com/pgvector/pgvector/blob/master/LICENSE).

For structured market questions, query exact source fields. A vector match should never supply a balance, current price, or executable venue identifier. For textual research, retain passage IDs, timestamps, revisions, rights, and source families; news copies should not count as independent evidence. **V0 extension:** measure retrieval recall on labeled questions and reject any cross-account or future-dated leakage.

Memory should retain hypotheses, inputs, decisions, mature outcomes, and corrections. An agent's old narrative is not a verified fact, and a winning trade does not prove its stated explanation caused the gain. Reuse the existing outcome-memory fixture designs as test ideas; build authoritative outcome ingestion before making them product memory.

## What collaboration should look like

The recommended unit of cooperation is a typed artifact with source references and a version, not an open-ended conversation history.

| Participant | Tools and inputs | Output and authority |
| --- | --- | --- |
| Research planner | Approved instruments, prior experiments, allowed data catalog | A bounded experiment request; cannot schedule unbudgeted provider work |
| Data/feature service | Typed feeds and historical snapshots | Validated observations and calculated features; no generated market facts |
| Quant researcher | Feature snapshots and a fixed experimental protocol | Hypothesis, factor/model code or parameters, testable predictions |
| Text analyst | Time-filtered source passages and calculation receipts | Claims classified as observed, derived, hypothetical, or forecast |
| Experiment runner | Frozen strategy/dataset/cost versions | Trial artifacts and metrics; no signing/network authority in generated code |
| Challenger | Claims, methods, and results | Specific contradictions and failure cases; cannot approve deployment |
| Portfolio service | Approved signals, account state, user limits | Target exposure and reservations; deterministic hard checks |
| Execution supervisor | Authorized intents and venue observations | Order lifecycle and reconciliation events; isolated credentials |
| Performance monitor | Mature outcomes and current operating health | Drift/suspension recommendations and deterministic protective triggers |

Use bounded fan-out for independent work, then explicit dependencies. Initial independent reports should be retained before agents see one another's conclusions. A challenger can request one bounded revision in the first prototype; unresolved disagreement produces an abstention or research-only result. Count model calls and preserve intermediate artifacts without storing hidden chain-of-thought.

Different personas or two gateways to the same model family do not establish independent evidence. Evaluate the value of each role by removing it under the same inputs and budget, and examine correlated errors. More agents are justified only by measured improvement in a specified task.

## Operations and agent interoperability

| Component | Recommendation and reason | Validation |
| --- | --- | --- |
| [OpenTelemetry Python](https://github.com/open-telemetry/opentelemetry-python), Apache-2.0 | **Reuse existing dependencies.** Trace evidence, experiment, decision, and order IDs across boundaries; check actual instrumentation rather than assuming installed packages mean coverage. | V8: follow one synthetic decision through recovery, with no secrets or hidden reasoning in telemetry. |
| [MLflow](https://github.com/mlflow/mlflow), Apache-2.0 | **Defer.** Useful experiment/model tracking, but Moeazi already owns experiments and scorecards. Add only if artifact comparison materially improves work without creating competing promotion authority. Hosted services are separate from the OSS project. | V3 extension: link one immutable model artifact to Lab records with no duplicated lifecycle ownership. |
| [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk), MIT | **Defer transport adoption; borrow typed tool boundaries.** Useful if several independent agent clients need the same read-only research tools. Internal Python calls are sufficient initially. | V4: enforce account/time scope and deny signer, withdrawal, and raw credential tools. |
| [A2A](https://github.com/a2aproject/A2A), Apache-2.0 | **Defer.** Interoperability with separately operated agents may matter later. It does not establish the quality or authority of another agent's claims. | V4 extension: an external result passes the same provenance, schema, and claim checks as an internal one. |

This is the relevant connection to a wider agent economy: Moeazi could exchange research tasks and artifacts with external agents through standard protocols. Those agents should enter as untrusted research contributors, not inherit trading authority. There is no reason to add a marketplace, autonomous payments, or public execution tools to validate the current trading architecture.

## Grounding acceptance example

Suppose an analyst says, “ETH liquidity improved, so increase the position.” The model must identify the metric, venue, instrument, comparison window, and evidence. Code verifies the metric and whether the approved strategy uses it. The allocator checks current exposure and computes a permissible target. A valid news citation alone cannot establish improved order-book depth or authorize the increase.

The system may accept a supported factual clause while rejecting the proposed action. It may also produce a well-grounded explanation for an economically unhelpful strategy. Keep claim quality, forecast quality, trading performance, and operational safety as separate metrics.
