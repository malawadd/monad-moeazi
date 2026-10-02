# Trading component comparisons

Research date: 30 September 2026. These are fit recommendations for Moeazi, not generic project rankings. **D** means documented; **S** means selected implementation source was inspected. No candidate has an integration runtime verification in this review. Release observations and exact inspected revisions are in the [evidence register](evidence-register.md).

## Data and quantitative building blocks

| Project and license | Evidence and capability | Fit, limits, and disposition | Validation |
| --- | --- | --- | --- |
| [CCXT](https://github.com/ccxt/ccxt), MIT | **D/S.** Python and TypeScript exchange interfaces; inspected Hyperliquid and Lighter adapters expose public data and private operations with unequal capability flags. | **Prototype public data only.** Small library integration inside an ingestion adapter. Venue limits, symbols, precision, and signing remain venue-specific; no private methods in an LLM toolset. | V1: map recorded responses into typed observations and compare with native semantics. |
| [Cryptofeed](https://github.com/bmoscon/cryptofeed), current source AGPL-3.0-or-later plus attribution term | **D; license S.** Specialized WebSocket feed handling. Current license differs from older permissive search results. | **Defer.** A separate streaming layer may help with order-book workloads, but first demonstrate a coverage or recovery gap in the selected adapters. Exact modified license and dependencies need review before inclusion in a strict license allowlist. | V1 extension: disconnect/gap recovery on the exact needed venue; inspect pinned license. |
| [Pandera](https://github.com/unionai-oss/pandera), MIT | **D.** Python dataframe schema and data checks. | **Defer.** Useful for offline batch datasets; existing Pydantic and explicit invariants can cover the first event contracts. Schema checks do not verify economic truth or source honesty. | V1 extension: compare detection of injected nulls, unit errors, and timestamp disorder with current checks. |
| [DuckDB](https://github.com/duckdb/duckdb), MIT | **D.** In-process analytical SQL and direct Parquet reads. | **Defer until replay data grows.** Useful local research reader; Timescale remains durable evidence owner. Exports need lifecycle/retention handling, not an unmanaged second archive. | V2 extension: identical snapshot selection and result hashes from Timescale export and local query. |
| [scikit-learn](https://github.com/scikit-learn/scikit-learn), BSD-3-Clause | **D.** Statistical baselines, pipelines, model selection, calibration tools. | **Adopt for a later baseline experiment.** CPU-first Python library; fit preprocessing only on training windows. `TimeSeriesSplit(gap=...)` is useful but does not automatically purge overlapping financial labels. | V3: chronological baseline, explicit overlapping-label exclusion, and fixed holdout. |
| [Optuna](https://github.com/optuna/optuna), MIT | **D.** Parameter search and pruning. | **Defer.** Add only after the experiment protocol is fixed. More trials increase selection risk; persist every trial and keep the final holdout hidden from the search. | V3 extension: bounded seeded search beats the fixed baseline on untouched data, with all trials retained. |

The [TimeSeriesSplit documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) describes chronological splits and a gap. Moeazi still needs domain-specific cutoffs for label horizons, publication delays, funding times, and revised data. This is a custom data contract, not another agent persona.

### Venue coverage is a per-operation question

In the inspected CCXT revision, the Python exchange registry contains Hyperliquid and Lighter. It does not contain entries named Orderly, GMX, Ostium, or Uniswap. That establishes absence from that registry, not absence from every external connector ecosystem. [Pinned registry](https://github.com/ccxt/ccxt/blob/aa892c3a755006b2483d45f123cfff6c9c38e69c/python/ccxt/__init__.py).

| Moeazi venue | Evidence inspected | Integration implication |
| --- | --- | --- |
| Hyperliquid | CCXT advertises OHLCV, books, funding history/rates, and positions; private calls use wallet/private-key configuration. | Good first public-data prototype. Do not import its private client into research workers or export an owner key to satisfy examples. |
| Lighter | CCXT advertises OHLCV, books, current funding rates, and positions; several single-rate/history flags are false. Signing configuration references a native signing library. | Qualify individual operations and signing dependencies separately. No assumption of parity with Hyperliquid. |
| Orderly | No matching entry in the inspected CCXT registry. | Preserve existing/native integration; authoritative account and order behavior remains a separate qualification task. |
| GMX | Existing TypeScript SDK boundary in Moeazi; not a CCXT registry entry in the inspection. | Keep native price/oracle, fee, lifecycle, and transaction semantics in the sidecar. |
| Ostium | Existing Python SDK dependency; not a CCXT registry entry in the inspection. | Keep native integration and certify its actual permission and lifecycle model separately. |
| Uniswap | Existing preparation/simulation path; not a CCXT registry entry in the inspection. | AMM swaps need pool/route, token-unit, gas, reorg, and receipt modeling. CLOB simulation is insufficient. |

Sources: [Hyperliquid adapter](https://github.com/ccxt/ccxt/blob/aa892c3a755006b2483d45f123cfff6c9c38e69c/python/ccxt/hyperliquid.py), [Lighter adapter](https://github.com/ccxt/ccxt/blob/aa892c3a755006b2483d45f123cfff6c9c38e69c/python/ccxt/lighter.py), and [Moeazi execution guide](../../agent-guide/wallets-and-execution.md). Capability flags and code existence are not live API tests.

## Engines and research platforms

### NautilusTrader

**Prototype for event replay; borrow lifecycle patterns.** LGPL-3.0; Python-facing integration with a Rust engine. The documented architecture covers backtesting, portfolio state, order lifecycle, and reconciliation. This is a stronger match for execution-sensitive evaluation than using analyst consensus as a fill simulator. [Project](https://github.com/nautechsystems/nautilus_trader), [architecture](https://nautilustrader.io/docs/latest/concepts/architecture/).

**Source finding:** reconciliation supports inferred/synthetic adjustments as well as received order/fill reports. The Hyperliquid execution configuration includes private-key and optional agent-wallet account settings. These are integration boundaries: an inferred fill must never be mislabeled as observed execution, and Moeazi's owner key must not be exported into the engine. [Reconciliation source](https://github.com/nautechsystems/nautilus_trader/blob/a3c2d34be31c9619ec604f5570cf05fcfb2ee536/crates/execution/src/reconciliation/mod.rs), [configuration](https://github.com/nautechsystems/nautilus_trader/blob/a3c2d34be31c9619ec604f5570cf05fcfb2ee536/crates/adapters/hyperliquid/src/config.rs).

**Limit:** the latest observed release is `v2.0.0rc5`, a prerelease. The source inspection used a later development SHA, so it does not prove that release has every inspected behavior. Start only in a disposable replay environment and inspect the chosen tag again. Do not connect live credentials or depend on the engine's Redis persistence as a new accounting source of truth. [Release](https://github.com/nautechsystems/nautilus_trader/releases/tag/v2.0.0rc5).

**Cost and effort judgment:** medium-to-high adapter effort; local CPU replay first, no mandatory hosted control plane identified. Venue coverage, fills, funding, and AMM modeling must pass V2. Reject live adoption if it requires replacing wallet authority or if release instability dominates the benefit.

### Freqtrade and FreqAI

**Prototype as a comparison harness; borrow bias checks.** GPL-3.0; Python application with crypto strategies, dry-run, backtesting, and FreqAI model workflows. Hyperliquid is in its documented exchange list. It offers a quicker candle-strategy baseline than a broad multi-venue execution engine. [Project](https://github.com/freqtrade/freqtrade), [license](https://github.com/freqtrade/freqtrade/blob/develop/LICENSE).

**Source finding:** backtesting loads funding-rate data, applies fees, and supports a more detailed timeframe. Those mechanisms do not establish queue position or real fill quality. Official documentation describes execution assumptions and warns that some settings cannot reproduce live behavior. [Inspected backtester](https://github.com/freqtrade/freqtrade/blob/f6a7b767a31720b2f34059dd7b166b28abef3f09/freqtrade/optimize/backtesting.py), [assumptions](https://www.freqtrade.io/en/stable/backtesting/#assumptions-made-by-backtesting).

**Limit and fit judgment:** low-to-medium effort as a separate research process; high disruption as Moeazi's account manager. Use static datasets and strategy exports, preserve its license obligations, and do not duplicate live order ownership. Its [lookahead analysis](https://docs.freqtrade.io/en/latest/lookahead-analysis/) is a useful comparator, not proof that a strategy generalizes. Run V2 with the same signal and costs as the main replay candidate.

### Qlib

**Prototype as a factor/model research adapter.** MIT; Python research workflow for datasets, training, evaluation, and portfolio backtests. It can supply repeatable experiments and model comparisons that Moeazi's specialist synthesis currently lacks. [Project and workflow](https://github.com/microsoft/qlib).

**Source finding:** the exchange simulator exposes deal prices, volume limits, opening/closing/minimum costs, and trade-unit handling, with defaults/examples oriented toward equities. Therefore importing crypto prices alone does not make the simulator appropriate for perpetuals or AMMs. [Inspected exchange simulator](https://github.com/microsoft/qlib/blob/be725493eb1a6bbb42bf11b37aa7669f59610ff1/qlib/backtest/exchange.py).

**Integration judgment:** medium effort for offline features and forecasts; substantially more for venue-faithful execution. Feed it approved dataset exports and return experiment artifacts to the existing Lab. Use a separate, versioned cost/execution evaluator for strategy acceptance. Historical data and any external provider remain separate dependencies. Release `v0.9.7` is older than the inspected source; freeze a compatible package set rather than following `main`. [Release](https://github.com/microsoft/qlib/releases/tag/v0.9.7).

**Validation:** V3 must establish point-in-time feature parity, correct crypto units, and train-only transformations before any RD-Agent optimization loop uses it. Fall back to scikit-learn plus the existing Lab if the adapter burden outweighs useful research capabilities.

### RD-Agent

**Prototype after Qlib's inputs and evaluation are reliable.** MIT; a research-development loop that generates and evaluates factors/models. This is directly relevant to agents doing measurable work beyond writing market opinions. Its research paper evaluates factor/model co-development, but those results are not evidence of an advantage on Moeazi's venues. [Project](https://github.com/microsoft/RD-Agent), [paper](https://arxiv.org/abs/2505.15155).

**Source/documentation finding:** factor experiments request an execution environment; documented coder environments include Docker and Conda. Default provider configuration uses its own model backend. That would bypass Moeazi's route versions and budgeting unless adapted. [Factor experiment](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/rdagent/scenarios/qlib/experiment/factor_experiment.py), [environment configuration](https://github.com/microsoft/RD-Agent/blob/484776c211e4fbbeef03e0ec00d6bbee7362a4f4/docs/installation_and_configuration.rst).

**Integration judgment:** high effort relative to simple research scripts. Use an isolated worker with a bounded provider bridge, read-only dataset mounts, denied network for generated code, and no wallet credentials or host Docker socket exposed to generated code. Return source hashes, trials, and metrics; never a deployment command. V4 first uses stubbed models, then a separately approved finite provider experiment. Reject the integration if route/cost isolation cannot be preserved.

### Hummingbot

**Borrow patterns now; defer a bot integration until market making is selected.** Apache-2.0; Python strategies and exchange connectors. Its Strategy V2 position executor separately manages open orders, barriers, shutdown, and close completion. [Project](https://github.com/hummingbot/hummingbot), [inspected executor](https://github.com/hummingbot/hummingbot/blob/9af100d6822da7d2d0291a906c730ef172284ee2/hummingbot/strategy_v2/executors/position_executor/position_executor.py).

**Fit judgment:** valuable reference for long-lived execution supervision, but another bot runtime would add connector, state, and credential ownership to reconcile. Claimed aggregate volume is not strategy profitability evidence. A future market-making prototype needs inventory, queue/adverse-selection, and cancellation tests in addition to directional backtests. V2/V6 apply; no native-wallet compatibility is assumed.

### LEAN and FinRL

**Defer LEAN; reject FinRL as the first production foundation.** [LEAN](https://github.com/QuantConnect/Lean) is an Apache-2.0 event-driven engine with Python/C# strategy support. It is credible for broader asset classes, but a .NET engine and brokerage/data integration add work that does not currently resolve Moeazi's specific venue and wallet gaps. The open-source engine is distinct from paid QuantConnect services or data. Revisit if the product expands beyond its current crypto venue scope; V2 remains the acceptance test.

[FinRL](https://github.com/AI4Finance-Foundation/FinRL) is MIT research infrastructure for reinforcement learning. It may support controlled experiments later. Its environment, reward, and fill assumptions require validation before results are economically meaningful. For the first 10–100 accounts, this report favors interpretable statistical baselines and an explicit risk owner. Reject automatic deployment of an RL policy trained in an unqualified simulator; reconsider only against V3/V7 baselines.

## Portfolio construction and risk

### CVXPY compared with PyPortfolioOpt

**Prototype CVXPY; defer PyPortfolioOpt.** [CVXPY](https://github.com/cvxpy/cvxpy) is Apache-2.0 convex optimization infrastructure. It allows Moeazi to express allocation objectives and constraints directly. [PyPortfolioOpt](https://github.com/PyPortfolio/PyPortfolioOpt), MIT, supplies higher-level portfolio methods such as efficient frontiers and hierarchical risk parity. The latter is useful research tooling, but perpetual collateral, open-order reservations, funding, and shared-wallet constraints still require application-owned modeling.

**Source finding:** CVXPY exposes infeasible, unbounded, and inaccurate solution statuses. Its dependency manifest includes open solver options. Choose an explicitly approved open-source solver such as [Clarabel](https://clarabel.org/stable/), rather than relying on an installed commercial solver. [Problem implementation](https://github.com/cvxpy/cvxpy/blob/5a53ac6d5becbb63af3a6fce32a91fee6c63dbb6/cvxpy/problems/problem.py), [dependency manifest](https://github.com/cvxpy/cvxpy/blob/5a53ac6d5becbb63af3a6fce32a91fee6c63dbb6/pyproject.toml).

**Integration judgment:** medium effort as a Python calculation library, no new service needed initially. Start with a fixed deterministic risk-budget allocator as comparator. After optimization, round to venue units and rerun exact hard checks. No feasible solution means no increase in risk; it does not permit an LLM to invent weights. V5 covers shared collateral, correlated exposure, rounding, solver failure, and concurrent reservations. A solver is not an account ledger, liquidations engine, or source of expected returns.

## Strategy families to investigate

These are experiment categories, not recommended trades or claims of profitability.

| Family | Components that could help | Main evidence requirement |
| --- | --- | --- |
| Trend and volatility targeting | Reviewed feature code, scikit-learn baselines, Nautilus/Freqtrade replay | Stability after costs across chronological periods; compare with cash and buy-and-hold at comparable risk |
| Regime-conditioned mean reversion | Qlib features, statistical models, event replay | Demonstrate that regime detection uses only prior information and survives adverse trends |
| Funding/basis strategies | Typed venue feeds, native funding records, portfolio constraints | Funding changes, borrow/collateral costs, legging risk, liquidations, and cross-venue capital fragmentation |
| Event-driven strategies | Grounded extraction, source timing, numerical features | A publication timestamp and evidence that information arrives before the traded response; LLM training leakage must be considered |
| Market making | Hummingbot patterns or qualified engine adapters | Inventory, cancellations, adverse selection, fee tiers, queue position, and rate limits |

For research breadth, explore all of these through the same artifact contract. For the first integrated demonstration, use one transparent strategy and one venue data source; that isolates tooling correctness before broadening market claims.
