# Agent collaboration grounding and controlled learning

The primary contribution of agents is research and interpretation. They do not replace observation quality, quantitative evaluation, account accounting, or execution supervision. Reuse Moeazi's provider routes and billing boundaries; no new framework may silently choose a model or open a separate paid provider path.

## Separate the grounding problems

| Problem | Recommended owner and mechanism | Qualification |
| --- | --- | --- |
| Retrieve relevant evidence | Snapshot-scoped SQL/text queries first; optional pgvector when measured necessary | Q7 wrong-account, wrong-market, future-data, and stale-source tests |
| Validate shape | Existing Pydantic contracts and structured provider outputs | Strict schema and typed missing/unknown outcomes |
| Verify financial facts | Instrument identity, typed observations, deterministic calculation receipts | Numeric/units/time fixtures with exact expected results |
| Verify textual support | Preserve citations; claim-to-passage checks and a separately evaluated semantic judge | Human-reviewed labels; false acceptance and rejection, not only an average score |
| Estimate predictive reliability | Held-out and forward outcomes, calibration, contribution tests | Q6/Q7; self-reported confidence is not probability |
| Control consequences | Independent risk and execution authorization | Q3/Q4/Q10; unsupported claims cannot expand exposure |

First fix the local attribution issue in `orchestrator._one` and `evaluation_pipeline_v2._run_subject` through versioned integration. The current overwrite makes the list of supplied documents look like model-selected citations. A vector database or stronger model does not repair that accounting error. [Local evidence L8](evidence-register.md#local-evidence).

## Framework and tooling decisions

| Project and core license | Capability and practical fit | Decision, qualification, and rejection |
| --- | --- | --- |
| [Temporal](https://github.com/temporalio/temporal), MIT | Existing Python durable jobs/schedules, waits and recovery; activity retries do not guarantee exactly-once venue effects | **Reuse.** Q4/Q5/Q12 crash, cancellation and retry tests. Keep venue idempotency/journal separate |
| Existing Pydantic/provider wrappers | Already enforce typed outputs, route selection, budgets, and trace metadata | **Reuse and extend.** Q7 attribution/calculation/unknown checks. No provider migration required |
| [LangGraph](https://github.com/langchain-ai/langgraph), MIT | D/S: explicit graph state, checkpointer/interrupt APIs; useful for complex bounded research branching | **Defer migration.** Prototype only if graph composition measurably simplifies Q8. Temporal remains durable process owner; reject competing retry/resume authority |
| [PydanticAI](https://github.com/pydantic/pydantic-ai), MIT | D: typed tools/models; overlaps current wrappers | **Defer.** Stubbed provider/usage/route parity first. Reject hidden provider substitutions or duplicated billing/retry behavior |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents), Apache-2.0 | D/S: analyst/challenger roles with its own model clients, configuration and memory | **Borrow patterns; prototype a comparator.** Q7 matched evidence/model budget against Moeazi and a quantitative baseline; reject importing its trader decision as authority |
| [RD-Agent](https://github.com/microsoft/RD-Agent), MIT | D/S: code-producing factor/model experimentation; inspected Qlib experiment and environment setup | **Prototype Stage 5 research worker after Q6/Q7.** Q8 fixed budget, reviewed inputs, reproducible artifacts, no secrets/signing/network escalation. Reject if it requires unrestricted host or separate unaccounted LLM access |
| [Ragas](https://github.com/vibrantlabsai/ragas), Apache-2.0 | D/S: claim-support metrics; some operations call models/embeddings; faithfulness checks retrieved support rather than source truth | **Borrow patterns; prototype offline second judge.** Q7 compare to existing semantic evaluator and reviewed labels. Reject if false accepts increase or cost lacks benefit |
| [Guardrails AI](https://github.com/guardrails-ai/guardrails), Apache-2.0 core | D: composable validators; individual hub validators and dependencies need separate license/provider review | **Borrow patterns.** Implement domain constraints with existing schemas first. Q7 measures whether a selected validator adds useful coverage; no broad plugin auto-installation |
| [NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails), Apache-2.0 inspected LICENSE | D/license S: conversational policy flows, not an account ledger or exact financial verifier | **Defer.** Consider only if customer interaction rules require it; reject as replacement for deterministic trade checks |
| [DSPy](https://github.com/stanfordnlp/dspy), MIT | D: optimize LM pipelines against examples/metrics; can optimize weaknesses in an unreliable judge | **Defer.** Q7 held-out claims with fixed budget and all trials retained, only after label quality is established |
| [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk), MIT | D: useful protocol for read-only research tools; does not establish data trust or tool authority | **Defer unless an external research client needs it.** Expose snapshots/calculations, never execution/signing. Reject tool surfaces that bypass worker capability restrictions |
| [A2A](https://github.com/a2aproject/A2A), Apache-2.0 | D: agent interoperability; unnecessary for current in-process/service collaboration | **Defer.** External artifacts remain untrusted and pass the same verification; no agent-to-agent authority inheritance |

The [earlier agent dossier](../agentic-trading/agent-components.md) contains inspected implementation links and additional limitations. Native backend contracts should remain provider/framework-neutral so a future library can be qualified without changing account authority.

## Collaboration protocol

1. The experiment or program freezes a snapshot, allowed tools, roles, route versions, and budget.
2. Quantitative workers calculate features independently of textual analysts.
3. Analysts produce typed claims with original references, uncertainty, and missing information.
4. A verifier resolves identity, time, units, and calculation receipts before synthesis.
5. A challenger can request one bounded revision initially; the limit is recorded in the experiment.
6. The approved strategy converts eligible artifacts into an intent or hold reason. Risk remains a separate decision.
7. The reporter explains observed outcomes and rejected alternatives using ledger-backed numbers.

No generic agent can fetch arbitrary account state, open a terminal, install dependencies, or request a signer. Generated research code runs in a disposable worker with reviewed datasets, CPU/memory/time limits, and no host Docker socket or account secrets. A source document or model response is never an instruction to change policy.

## Learning and memory

Store versioned episodes linking decision cutoff, evidence, rejected actions, fills, costs, and outcome horizon. Separate actual outcomes from simulated counterfactuals and from explanations generated afterward. Revised outcomes append provenance; they do not rewrite an experiment to improve its score.

Initially learning creates candidates, not automatic production edits. Research can compare role removal, provider/model replacements, new factors, and strategy parameters. Failed trials count toward the search budget and remain discoverable. Promotion requires independent held-out/forward evidence and compatibility checks.

Historical LLM tests can be contaminated by training knowledge even when supplied data are time-filtered; use anonymized/controlled tasks where appropriate and forward shadow validation for market claims. [Research on LLM lookahead bias](https://arxiv.org/abs/2309.17322). This is a limitation of inference from historical tests, not evidence that any specific current Moeazi run leaked.

## Default research decisions

Start with existing provider wrappers, typed calculations, citation preservation, and one quantitative versus agent-assisted comparison. Broader agent frameworks are not prerequisites. Introduce Qlib/RD-Agent where they produce measurable research artifacts, not because more personas imply better trading.

Required outcomes are lower unsupported-claim acceptance, reproducible decisions, useful prediction/strategy contribution after costs, and bounded operational burden. A high judge score cannot override failed financial checks. No tool here promises to eliminate hallucinations or guarantee returns.
