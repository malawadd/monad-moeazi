# Evidence — Claim-Level Disagreement Ledger

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Structured specialist roles and targeted Bull/Bear debate are implementable | TradingAgents sources S04 and S05 | Research implementation and stock backtests |
| Hierarchical analyst-to-manager communication can reduce unnecessary peer communication | FinCon source S02 | Research/backtest evidence |
| Unimoazi already has role specialization, critic/challenger/arbiter stages, and model-family quorum | Sources U03 and U05 | Direct implementation evidence |
| Current synthesis has flat conflict strings rather than typed claim relations | `contracts.py`, `orchestrator.py`, and source U06 | Direct implementation evidence |

## Unimoazi-specific inference

External work does not validate the proposed claim schema, conflict algorithm, or
percentage benefits. The recommendation follows from combining an observed local gap
with a conservative part of the external pattern: structured communication.

## Counterevidence and limitations

- Multiple agents may repeat a shared factual or modeling error.
- Majority support does not establish truth.
- Semantic equivalence is difficult across differently worded or differently scoped
  claims.
- Extra claim fields can increase prompt size and latency.
- Conditional escalation may save no cost in conflict-heavy markets.
- TradingAgents and FinCon use equities and historical evaluation; neither proves
  improved crypto trading or live operational safety.

## Evidence freshness

The external papers and project pages were checked on 2026-08-05. Revalidate the
current `SignalReport`, synthesis, tier, routing, and Evaluation Lab contracts before
implementation because the dossier depends on their exact shape.
