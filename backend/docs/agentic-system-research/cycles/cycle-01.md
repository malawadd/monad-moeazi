# Cycle 01 — Memory, Disagreement, and Execution Boundaries

## Research question

Which mechanisms from agentic trading research and Web3 agent platforms add value to
Unimoazi's existing specialist/quorum architecture without expanding model authority?

## Systems reviewed

- FinMem, FinCon, and QuantAgent for outcome-linked memory and learning.
- TradingAgents for specialist debate and risk-team organization.
- Almanak for typed intents, compilation, simulation, and gateway isolation.
- Giza for explicit lifecycle states and optimizer/execution separation.
- Coinbase AgentKit for typed actions and an important negative example: model-facing
  wallet actions.
- Olas for decentralized agent coordination and registry patterns.

The papers are research/backtest evidence. Vendor documentation proves described
interfaces and architecture, not strategy returns or production safety.

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| Outcome-linked immutable decision memory | Approved in phases | 89 | Capture immutable decisions/outcomes first; retrieval and promotion remain gated |
| Claim-level disagreement ledger | Approved, Evaluation Lab first | 88 | Add typed claims and selective escalation, not another generic debate layer |
| New `ExecutionIntent` compiler | Held | 67 | Duplicates existing proposal, decision, workflow, preflight, and trace contracts |
| Authoritative risk snapshot and reconciliation receipt | Approved reframe | 91 | Replace placeholder risk inputs and complete lifecycle evidence within existing boundaries |

## Benefit discipline

The cycle produced test hypotheses, not production projections:

- Memory: test for 5–15% relative calibration improvement and 10–25% fewer
  pre-classified repeated errors; confidence is low to medium.
- Disagreement: test for 15–35% fewer unaddressed material contradictions and
  10–25% lower escalation tokens; measure net cost because claim fields add tokens.
- Risk/reconciliation: require complete authoritative policy inputs and lifecycle
  receipts. Do not claim PnL improvement.

## Changes to the research direction

The initial research order put analytical mechanisms first. The audit reversed the
implementation priority because `execution_workflow.py` currently constructs several
policy inputs with zero placeholders and optimistic booleans. Closing that safety gap
is more urgent than adding analytical sophistication.

Cycle 02 therefore targets promotion/demotion criteria, portfolio-aware sizing, and
multi-venue execution quality.
