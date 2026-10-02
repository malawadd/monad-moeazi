# Trading component comparisons and decisions

Evidence notation: **D** documented; **S** selected source inspected; **L** locally executed verification. No upstream integration has L evidence in this research. Reviewed commits and release observations are in the [evidence register](evidence-register.md); they are research references, not installation instructions. Qualifications Q1–Q12 are defined in [validation-and-gates.md](validation-and-gates.md).

## Data and analytical infrastructure

| Project and core license | Capability, fit, and limits | Decision and integration | Qualification and rejection |
| --- | --- | --- | --- |
| Native venue adapters | S/local: exact payloads, funding, token units, and order events cannot be made correct by a generic endpoint wrapper | **Adopt approach.** Adapter emits `MarketObservation`/`InstrumentVersion`; reuse existing HTTP/TS clients and recorded payloads | Q2: known schema/time/unit/gap cases. Reject an operation whose native semantics cannot be established |
| [CCXT](https://github.com/ccxt/ccxt), MIT | D/S: Python/TS normalization; inspected registry includes Hyperliquid and Lighter, not named Orderly/GMX/Ostium/Uniswap entries. Capability parity varies | **Prototype public-data library.** Keep private clients out of research; normalize again into Moeazi contracts. No mandatory hosted control plane identified | Q2: compare native recorded responses for candles/books/funding. Reject any required field inferred or silently absent |
| [Cryptofeed](https://github.com/bmoscon/cryptofeed), inspected AGPL-3.0-or-later plus attribution term | S/license: broad streaming alternative, but license differs from older permissive descriptions; connector coverage must be checked separately | **Defer.** Consider only if native/CCXT streaming gaps justify another feed process and license review | Q2 extension: gap/reconnect workload and exact dependency/license review; no adoption while license implications remain unresolved |
| [Pandera](https://github.com/unionai-oss/pandera), MIT | D: dataframe schemas complement current Pydantic object validation; no venue truth or historical rights supplied | **Defer until batch pipeline.** Use when bulk research datasets benefit from column-level validation | Q2: catch seeded schema/unit/null defects at acceptable CPU cost; retain Pydantic alone if no measurable benefit |
| [DuckDB](https://github.com/duckdb/duckdb), MIT | D: local analytical queries over columnar data; not an account ledger or replacement backend | **Prototype bounded research-query adapter only when needed.** Input is lifecycle-approved immutable export; output is reproducible calculations | Q2/Q6: identical snapshot/result selection to source export; reject unmanaged data copies or conflicting truth |
| Existing Timescale/Postgres | S/local: already owns detailed evidence/history; supports ordinary transactional tables beside history | **Reuse.** Financial journal/reservations are bounded new domain code; research experiments remain backend-owned | Q3/Q5: atomic state, dedupe, publication recovery, namespace isolation |
| [pgvector](https://github.com/pgvector/pgvector), PostgreSQL license | D/license S: optional similarity retrieval within Postgres; relevance is not truth or temporal validity | **Defer.** SQL identity/time filters first; add only for demonstrated text-retrieval need | Q7: retrieval improves held-out claim support without cross-account/future leakage; reject if ordinary queries suffice |
| [OpenBB ODP](https://github.com/OpenBB-finance/OpenBB), Apache-2.0 at reviewed revision | D/S: Python data integration; inspected Fetcher separates extraction/transformation and defaults to requiring credentials. Provider data can be proprietary/paid | **Defer for macro/fundamental research.** Optional enrichment adapter, never the primary order-book or account feed. OpenBB Workspace is a separate enterprise UI and is not selected | Q2/Q6: one permitted provider/dataset improves a registered experiment; reject paid/unclear rights or irrelevant equity defaults |

Native and CCXT data still need availability timestamps, source identity, sequence/finality, and rights. A successful JSON response is not an executable quote. This directly addresses the current `JsonHttpAdapter` limitations in [L9](evidence-register.md#local-evidence).

## Replay and execution engines

### NautilusTrader

**Prototype replay; borrow lifecycle patterns; defer live hosting.** LGPL-3.0, Python/Rust. The earlier review inspected adapter configuration and reconciliation at a pinned development SHA. It also observed release `v2.0.0rc5`; that is a prerelease, not an approved runtime pin. Current reconciliation documentation distinguishes internal state from venue reports and describes recovery from cached or absent state. [Official reconciliation](https://nautilustrader.io/docs/latest/concepts/execution/reconciliation/), [earlier source inspection](../agentic-trading/trading-components.md#nautilustrader).

Its attraction is substantial event/replay machinery rather than another LLM layer. Its risk is duplicating account state, order ownership, credential handling, and process lifecycle. The qualification adapter consumes frozen observations and strategy intents and returns typed simulated events. It cannot write live positions or treat inferred fills as observed truth.

**Q4/Q6:** compare with a hand-calculated oracle for fees, funding, partial fills, cancellation, and latency; require identical contract semantics and recorded simulation limitations. If a compatible stable artifact cannot pass without replacing wallet ownership, reject live embedding and retain replay/pattern reuse. Resource expectation is CPU/memory proportional to event volume; measure actual runtime before selecting hardware.

### Freqtrade and FreqAI

**Prototype candle-strategy comparator; borrow bias checks.** GPL-3.0, Python. The earlier source review found funding and fee inputs plus finer-timeframe support. Its official documentation makes simulation assumptions explicit, and lookahead analysis checks certain future-data effects. These are useful comparative controls, not proof of fill realism. [Backtesting](https://www.freqtrade.io/en/stable/backtesting/), [lookahead analysis](https://www.freqtrade.io/en/stable/lookahead-analysis/).

Run offline with the same frozen signals/costs as Moeazi. Do not deploy its bot as a second controller for an existing account. The GPL is not rejected by the OSS requirement; distribution/integration obligations must be examined for the chosen deployment.

**Q4/Q6:** hand-calculated round trips, chronological holdouts, detail-timeframe sensitivity, and explicit unsupported behavior. Reject it as the primary simulator where missing partial fills, AMM semantics, or collateral assumptions dominate. FreqAI is an optional model workflow, not a reason to duplicate current provider or experiment services.

### Hummingbot

**Borrow position-management patterns; defer whole-engine adoption.** Apache-2.0 engine; its API has a different MIT license. The earlier pinned `PositionExecutor` separates entry, barriers, and shutdown. This is relevant to the missing continuous supervisor. The broader Dashboard/API comparison appears in [operator-components.md](operator-components.md).

A full deployment brings connectors, bot lifecycle, credentials, and its own operating assumptions. Compatibility with Moeazi's owner signers and isolated execution boundary is not established. Market making may later justify a controller experiment, but it introduces inventory, adverse selection, queue position, and high cancel-rate demands beyond the first foundation.

**Q4/Q10:** evaluate a recorded partial-fill/protection lifecycle against Moeazi's contracts. Reject direct adoption if it imports owner keys, duplicates live order ownership, or requires broad host/container control in a research worker.

### LEAN and the FinRL family

| Project | Assessment and disposition | Qualification if revisited |
| --- | --- | --- |
| [LEAN](https://github.com/QuantConnect/Lean), Apache-2.0 | **Defer.** C# engine with Python strategy support is a credible broader-asset alternative. Brokerage/data/plugin scope and .NET integration add burden; no six-venue or Magic/Particle parity established | Q4/Q10: one identical strategy and native-account lifecycle with no hosted dependency; reject if wallet/account adaptation outweighs reusable engine value |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL), MIT | **Reject as first production foundation; defer research.** RL environments/agents do not establish authoritative risk, venue protection, or stable out-of-sample behavior | Q6: compare fixed seeds and held-out risk-adjusted results against simple baselines; no live authority |
| [FinRL-X / FinRL-Trading](https://github.com/AI4Finance-Foundation/FinRL-Trading), Apache-2.0 at reviewed SHA | **Borrow the uniform portfolio-target interface; defer integration.** Distinct from MIT FinRL. Documentation describes weight-oriented strategies and an Alpaca-oriented execution path; claimed performance is not Moeazi evidence. Strategy source path probe failed, so behavior remains D, not S | Q6/Q10: demonstrate crypto instrument/funding/permission fit first; reject direct production replacement while that gap remains |

## Quantitative research and allocation

| Project and core license | Fit and boundary | Disposition, experiment, and rejection |
| --- | --- | --- |
| [scikit-learn](https://github.com/scikit-learn/scikit-learn), BSD-3-Clause | Python CPU-first statistical baselines, feature pipelines, calibration; existing datasets must supply reliable labels | **Adopt for Stage 5 baseline research**, after Q6. Training-only preprocessing, purged overlapping labels, time-ordered holdouts. Reject a model that adds no net value versus simpler baseline |
| [Qlib](https://github.com/microsoft/qlib), MIT | D/S: repeatable feature/model research. Inspected exchange defaults are equity-oriented; funding, crypto units, and AMM costs need external evaluation | **Prototype research adapter.** Return artifact references to existing Lab, not another customer ledger. Q6 requires same dataset, cutoffs, costs, and held-out comparison; reject using stock simulator defaults as crypto execution truth |
| [Optuna](https://github.com/optuna/optuna), MIT | Bounded parameter search, trial history; more trials increase selection bias | **Defer until baseline/holdout protocol passes.** Q6 extension freezes objective/search budget before trials. Reject unrecorded searches or repeated tuning against the holdout |
| Simple risk-budget allocator | Current fixed order cap is not portfolio sizing; a small deterministic allocator supplies an auditable baseline | **Bounded custom implementation in Stage 2/3.** Q3/Q9: exact units, shared collateral, fees, rounding, infeasibility and concurrent reservations |
| [CVXPY](https://github.com/cvxpy/cvxpy), Apache-2.0 | D/S: constraint optimization, with explicit infeasible/unbounded/inaccurate outcomes; open solvers available | **Prototype after simple allocator.** Use an OSS solver (e.g. Clarabel after its dependency review); exact hard checks after rounding. Q9 rejects infeasible/inaccurate output, greater risk, or no useful allocation benefit |
| [PyPortfolioOpt](https://github.com/PyPortfolio/PyPortfolioOpt), MIT | Higher-level portfolio optimization; expected return/covariance estimates and collateral semantics remain Moeazi's responsibility | **Defer.** Q9 comparative experiment only after multiple competing exposures justify it; do not introduce both it and CVXPY wrappers without a distinct benefit |

Qlib and scikit-learn do not supply trustworthy prices or a production trading strategy merely by training a model. The [TimeSeriesSplit documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) supports chronological splitting and gaps, but domain-specific purging and publication times remain required.

## Strategy families and selection protocol

Research trend/volatility targeting, regime-conditioned mean reversion, event-driven signals, and funding/basis approaches. Keep market making and multi-leg strategies deferred until their inventory/legging/collateral paths are modeled. Neither spot nor perpetuals is excluded from the target.

Use one transparent deterministic baseline to validate interfaces. The first funded strategy is a separate outcome of Stage 5: freeze its universe, frequency, sizing, risk policy, cost assumptions, failure behavior, and stop rules before holdout evaluation. Compare cash and exposure-matched buy-and-hold. Report negative and inconclusive results; an unattractive baseline is not permission to lower the acceptance standard.

The prior ETH-only example is a useful test instrument, not a user-approved production universe. No claim that a bullish condition should always buy spot or a bearish condition should always short survives without measured costs, risk, and uncertainty.

## Practical resource and maintenance conclusions

Focused native/CCXT integrations have low additional service burden but meaningful semantic maintenance. Qlib/RD-Agent and large replay workloads need bounded research workers, dataset storage, and CPU/memory measurement; GPU is not a prerequisite for the baseline. Full Hummingbot/LEAN/Nautilus live adoption creates a larger lifecycle and deployment surface.

Exact package artifacts, transitive licensing, optional binary signers, feeds, and containers must be frozen before prototype installation. Current default-branch activity is not a release support guarantee. The report's reviewed revisions identify evidence; a later package selection must rerun compatibility tests rather than following `latest`.
