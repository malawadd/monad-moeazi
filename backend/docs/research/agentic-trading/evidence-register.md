# Evidence register and research limits

Research date: 30 September 2026. Local repository HEAD observed: `e215f0eb363217c76d30e7c8c569c0acd846ab3e`. The working tree already contained unrelated product/UI edits, so local observations refer to the inspected working tree rather than claiming a clean checkout. This research adds only the files in this report directory.

## Verification levels

- **Documented:** official documentation, repository description, API metadata, release notes, or license text describes the capability. No execution claim follows.
- **Source inspected:** selected implementation paths or manifests were read. This is bounded static inspection, not a full audit, dependency review, or proof of behavior under all inputs.
- **Locally verified:** an identified runtime test was executed with recorded inputs and outputs. **No third-party integration qualifies for this label in this review.** Local file/link/format validation verifies the report artifact only.

All proposed component combinations, effort ratings, deployment shapes, and adoption decisions are this report's engineering judgments. Stars, contributor counts, publisher claims, and reported trading volume were not used as profitability or reliability evidence.

## Local implementation evidence

Links resolve to current source. Line references below identify the inspection and can drift after edits.

| Source | Observation | Consequence |
| --- | --- | --- |
| [orchestrator.py](../../../agent-service/src/moeazi_agent/orchestrator.py), line 114 | Model report evidence replaced with supplied references | Preserve original citations before measuring grounding |
| [evaluation_pipeline_v2.py](../../../agent-service/src/moeazi_agent/evaluation_pipeline_v2.py), lines 106–110 and 136 | Evaluation also replaces evidence before citation validation | Current citation-validity comparison can mask model attribution errors |
| [evaluation_engine.py](../../../agent-service/src/moeazi_agent/evaluation_engine.py), lines 124–157 | Checks citation membership, coarse market reference, and confidence/citation count | Not claim-level factual verification |
| [grounding_evaluator.py](../../../agent-service/src/moeazi_agent/grounding_evaluator.py) | Existing typed semantic evaluator calls configured provider implementations | Compare external evaluation tools with this rather than assume no evaluator exists |
| [synthesis.py](../../../agent-service/src/moeazi_agent/synthesis.py), lines 34–45 | Self-reported confidence weights scores; draft can override synthesis | Consensus/confidence are not established calibrated forecasts |
| [proposal_routing.py](../../../agent-service/src/moeazi_agent/proposal_routing.py), lines 12–35 | Thresholds, capped size/leverage, initially empty protective exits | Portfolio sizing requires an authoritative owner |
| [data_adapters.py](../../../agent-service/src/moeazi_agent/data_adapters.py) | Generic HTTP payload, text normalization, fixed quality value | Validate native endpoint contracts and typed numerical semantics |
| [evaluation_engine.py](../../../agent-service/src/moeazi_agent/evaluation_engine.py), lines 207–236 | Entry-price slippage plus explicit cost outputs and fallback values | Establish cost oracle before comparing replay engines |
| [evaluation_outcomes.py](../../../agent-service/src/moeazi_agent/evaluation_outcomes.py), lines 98–106 | Settlement subtracts fees/slippage and an estimated exit cost | Potential slippage double-counting concern; not runtime-reproduced here |
| [customer_research_api.py](../../../agent-service/src/moeazi_agent/customer_research_api.py) | Ownership, preview, cost/credit, and shadow-only checks | Preserve current Research orchestration and budget boundaries |
| [execution_workflow.py](../../../agent-service/src/moeazi_agent/execution_workflow.py), lines 77–84 | Zero current risk inputs and false health/reconciliation flags | No basis for claiming production risk readiness |
| [venues.py](../../../agent-service/src/moeazi_agent/venues.py), lines 102–109 | Hyperliquid place/cancel/close intentionally raise | Public data support does not establish private execution |
| [server.ts](../../../execution-sidecar/src/server.ts), lines 146–158 | Gated/unavailable signing and broadcast paths | No live certification inferred from preparation/simulation |

The [project guide](../../agent-guide/README.md), [architecture](../../agent-guide/architecture.md), [agent system](../../agent-guide/agent-system.md), [data ownership](../../agent-guide/data-and-caching.md), [execution guide](../../agent-guide/wallets-and-execution.md), [test guidance](../../agent-guide/testing-and-debugging.md), and [known gaps](../../agent-guide/known-gaps.md) establish intended ownership and fixture/product boundaries. Where the code provides a narrower capability than an architecture description, this report uses the narrower finding.

## Pinned upstream source inspection

GitHub public repository/commit APIs supplied the revisions; raw files at those revisions were read without executing them. Most are default-branch revisions, not release pins. They must not be assumed identical to a packaged release.

| Project and inspected revision | Source paths read | Finding and limit |
| --- | --- | --- |
| Nautilus `a3c2d34be31c9619ec604f5570cf05fcfb2ee536` | [Hyperliquid config](https://github.com/nautechsystems/nautilus_trader/blob/a3c2d34be31c9619ec604f5570cf05fcfb2ee536/crates/adapters/hyperliquid/src/config.rs), [reconciliation](https://github.com/nautechsystems/nautilus_trader/blob/a3c2d34be31c9619ec604f5570cf05fcfb2ee536/crates/execution/src/reconciliation/mod.rs) | Private-key/agent account configuration; observed versus inferred reconciliation. No signer adapter or runtime test. |
| CCXT `aa892c3a755006b2483d45f123cfff6c9c38e69c` | [registry](https://github.com/ccxt/ccxt/blob/aa892c3a755006b2483d45f123cfff6c9c38e69c/python/ccxt/__init__.py), [Hyperliquid](https://github.com/ccxt/ccxt/blob/aa892c3a755006b2483d45f123cfff6c9c38e69c/python/ccxt/hyperliquid.py), [Lighter](https://github.com/ccxt/ccxt/blob/aa892c3a755006b2483d45f123cfff6c9c38e69c/python/ccxt/lighter.py) | Unequal data capabilities; private signing assumptions. No live endpoint verification. |
| Qlib `be725493eb1a6bbb42bf11b37aa7669f59610ff1` | [exchange simulator](https://github.com/microsoft/qlib/blob/be725493eb1a6bbb42bf11b37aa7669f59610ff1/qlib/backtest/exchange.py) | Explicit costs, volume, trade units, equity-oriented defaults. No complete crypto-model audit. |
| RD-Agent `484776c211e4fbbeef03e0ec00d6bbee7362a4f4` | [factor experiment](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/rdagent/scenarios/qlib/experiment/factor_experiment.py), [configuration](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/docs/installation_and_configuration.rst) | Environment/provider integration requirements. No generated code or provider calls run. |
| Freqtrade `f6a7b767a31720b2f34059dd7b166b28abef3f09` | [backtesting](https://github.com/freqtrade/freqtrade/blob/f6a7b767a31720b2f34059dd7b166b28abef3f09/freqtrade/optimize/backtesting.py) | Fee, detail-timeframe, funding inputs. No verification of venue-faithful fills. |
| Hummingbot `9af100d6822da7d2d0291a906c730ef172284ee2` | [position executor](https://github.com/hummingbot/hummingbot/blob/9af100d6822da7d2d0291a906c730ef172284ee2/hummingbot/strategy_v2/executors/position_executor/position_executor.py) | Open/barrier/shutdown lifecycle separation. No wallet compatibility or connector audit. |
| TradingAgents `8b22d43d01d9ddda5d686d093d5385884622f3de` | [trading graph](https://github.com/TauricResearch/TradingAgents/blob/8b22d43d01d9ddda5d686d093d5385884622f3de/tradingagents/graph/trading_graph.py) | Own model clients/configuration, memory and checkpoint handling. No claim of profitable or certified execution. |
| LangGraph `07b33185eab893be2ed031eedae52f09314bf77c` | [state graph](https://github.com/langchain-ai/langgraph/blob/07b33185eab893be2ed031eedae52f09314bf77c/libs/langgraph/langgraph/graph/state.py) | Checkpointer and interrupt compile options. No nested Temporal recovery proof. |
| CVXPY `5a53ac6d5becbb63af3a6fce32a91fee6c63dbb6` | [problem implementation](https://github.com/cvxpy/cvxpy/blob/5a53ac6d5becbb63af3a6fce32a91fee6c63dbb6/cvxpy/problems/problem.py), [manifest](https://github.com/cvxpy/cvxpy/blob/5a53ac6d5becbb63af3a6fce32a91fee6c63dbb6/pyproject.toml) | Solver statuses and open solver dependencies. No portfolio/rounding benchmark. |
| Cryptofeed `6cbd9b959f104fe970791d32444a2ef13ddacc2f` | [license](https://github.com/bmoscon/cryptofeed/blob/6cbd9b959f104fe970791d32444a2ef13ddacc2f/LICENSE) | Current AGPL-3.0-or-later text with additional attribution term; older search extracts conflict. No dependency compliance conclusion. |

Additional moving-branch reads: [Ragas faithfulness implementation](https://github.com/vibrantlabsai/ragas/blob/main/src/ragas/metrics/_faithfulness.py), [NeMo license](https://github.com/NVIDIA-NeMo/Guardrails/blob/develop/LICENSE.md), and [pgvector license](https://github.com/pgvector/pgvector/blob/master/LICENSE). These are dated observations, not immutable release evidence.

## Release observations

These were obtained from the public GitHub releases API on the research date. They describe the newest entries returned, not a recommended upgrade. A `prerelease=false` flag is not a safety certification.

| Project | Latest observed release | Published UTC | Prerelease flag |
| --- | --- | --- | --- |
| NautilusTrader | [v2.0.0rc5](https://github.com/nautechsystems/nautilus_trader/releases/tag/v2.0.0rc5) | 2026-09-15 | true |
| Qlib | [v0.9.7](https://github.com/microsoft/qlib/releases/tag/v0.9.7) | 2025-08-15 | false |
| RD-Agent | [v1.0.0](https://github.com/microsoft/RD-Agent/releases/tag/v1.0.0) | 2026-09-23 | false |
| Freqtrade | [2026.9](https://github.com/freqtrade/freqtrade/releases/tag/2026.9) | 2026-09-29 | false |
| Hummingbot | [v2.17.0](https://github.com/hummingbot/hummingbot/releases/tag/v2.17.0) | 2026-09-22 | false |
| TradingAgents | [v0.5.2](https://github.com/TauricResearch/TradingAgents/releases/tag/v0.5.2) | 2026-09-29 | false |

The Nautilus README explicitly distinguishes release-candidate/development wheels from production use. Qlib's release date is materially older than its inspected default-branch source. Both facts require deliberate version selection in a prototype rather than copying commands from current docs.

## Maintenance and license observations

All repositories below returned `archived=false`. Dates are repository `pushed_at` observations, which can reflect branches other than the inspected default branch; they are not last releases, security guarantees, or proof of active support. Repository links provide primary project context; the [GitHub repository API](https://docs.github.com/en/rest/repos/repos#get-a-repository) defines the metadata endpoint used.

| Project | Repository push date UTC | License observation |
| --- | --- | --- |
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) | 2026-09-30 | LGPL-3.0 |
| [CCXT](https://github.com/ccxt/ccxt) | 2026-09-29 | MIT |
| [Cryptofeed](https://github.com/bmoscon/cryptofeed) | 2026-09-28 | API NOASSERTION; inspected license AGPL-3.0-or-later plus attribution term |
| [Qlib](https://github.com/microsoft/qlib) | 2026-09-22 | MIT |
| [RD-Agent](https://github.com/microsoft/RD-Agent) | 2026-09-30 | MIT |
| [Freqtrade](https://github.com/freqtrade/freqtrade) | 2026-09-29 | GPL-3.0 |
| [Hummingbot](https://github.com/hummingbot/hummingbot) | 2026-09-28 | Apache-2.0 |
| [LEAN](https://github.com/QuantConnect/Lean) | 2026-09-29 | Apache-2.0 |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | 2026-09-28 | MIT |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) | 2026-09-29 | Apache-2.0 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 2026-09-29 | MIT |
| [Pydantic AI](https://github.com/pydantic/pydantic-ai) | 2026-09-30 | MIT |
| [Guardrails AI](https://github.com/guardrails-ai/guardrails) | 2026-09-25 | Apache-2.0 |
| [NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails) | 2026-09-29 | API NOASSERTION; inspected LICENSE.md identifies Apache-2.0 |
| [Ragas](https://github.com/vibrantlabsai/ragas) | 2026-02-24 | Apache-2.0 |
| [DSPy](https://github.com/stanfordnlp/dspy) | 2026-09-29 | MIT |
| [CVXPY](https://github.com/cvxpy/cvxpy) | 2026-09-28 | Apache-2.0 |
| [PyPortfolioOpt](https://github.com/PyPortfolio/PyPortfolioOpt) | 2026-07-07 | MIT |
| [Optuna](https://github.com/optuna/optuna) | 2026-09-30 | MIT |
| [scikit-learn](https://github.com/scikit-learn/scikit-learn) | 2026-09-29 | BSD-3-Clause |
| [MLflow](https://github.com/mlflow/mlflow) | 2026-09-30 | Apache-2.0 |
| [DuckDB](https://github.com/duckdb/duckdb) | 2026-09-29 | MIT |
| [pgvector](https://github.com/pgvector/pgvector) | 2026-09-29 | API NOASSERTION; inspected PostgreSQL license text |
| [Pandera](https://github.com/unionai-oss/pandera) | 2026-09-26 | MIT |
| [A2A](https://github.com/a2aproject/A2A) | 2026-09-29 | Apache-2.0 |
| [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) | 2026-09-29 | MIT |
| [OpenTelemetry Python](https://github.com/open-telemetry/opentelemetry-python) | 2026-09-30 | Apache-2.0 |

Temporal is already a local dependency; its [upstream license](https://github.com/temporalio/temporal/blob/main/LICENSE) is MIT. Clarabel's [official project documentation](https://clarabel.org/stable/) identifies Apache-2.0. These supporting projects did not receive the same metadata/source breadth as the new primary candidates.

Licenses in this table concern the named core repositories. They do not approve every optional plugin, data feed, binary signer, solver, model weight, hosted service, or transitive dependency. Before adoption, pin the exact artifact and inspect its complete dependency/license manifest. Copyleft is not automatically excluded by the user's open-source requirement; integration and distribution obligations still need to be understood. Cryptofeed's extra term remains an explicit qualification item, not a resolved legal conclusion.

## Other primary references

- [Nautilus architecture](https://nautilustrader.io/docs/latest/concepts/architecture/): engine, risk, portfolio, execution responsibilities.
- [Freqtrade backtesting](https://www.freqtrade.io/en/stable/backtesting/): simulation assumptions and configuration caveats.
- [Freqtrade lookahead analysis](https://docs.freqtrade.io/en/latest/lookahead-analysis/): a useful test approach, not an edge guarantee.
- [scikit-learn TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html): chronological split/gap semantics.
- [Ragas faithfulness](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/faithfulness/): support in retrieved context, distinct from source truth.
- [R&D-Agent-Quant paper](https://arxiv.org/abs/2505.15155): automated factor/model research; its benchmarks are not Moeazi outcomes.
- [LLM lookahead-bias research](https://arxiv.org/abs/2309.17322): training-period knowledge can contaminate historical sentiment backtests.

Some official documentation URLs were unavailable to the browser fetcher. The report uses accessible official repositories/source as fallback rather than treating a search snippet as settled evidence. No proprietary service was selected to resolve these gaps.

## Remaining uncertainty

Historical market data coverage, redistribution/usage rights, complete transitive licensing, native signer compatibility, package compatibility, hardware capacity, security audit quality, and strategy performance remain unverified. These are recorded in the prototype acceptance criteria, not hidden behind a “production-ready” label.

The report's recommendation is consequently conditional: it identifies a coherent set of components and the experiments needed to decide adoption. It does not claim that adding those packages completes live trading or eliminates LLM hallucination.
