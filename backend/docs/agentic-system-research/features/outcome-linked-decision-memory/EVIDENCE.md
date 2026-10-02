# Evidence — Outcome-Linked Immutable Decision Memory

## Local implementation evidence

The repository now contains a synthetic, deterministic Test Center proof for episode
linkage, outcome revision, maturity, scoring, retrieval, and correction invalidation.
This validates contract mechanics only; it does not increase the strength of the
research evidence or establish calibration, error-rate, PnL, or production benefit.

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Layered recency/relevance/importance memory and top-K choice can affect agent behavior and backtest outcomes | FinMem source S01 | Research/backtest with retrieval ablations |
| Episodic outcome feedback and selective belief propagation can improve historical financial tasks | FinCon source S02 | Peer-reviewed research/backtest |
| A separate environment-feedback loop can refine a domain knowledge base | QuantAgent source S03 | Research framework and historical experiments |
| Unimoazi already stores detailed traces and supports immutable replay/live-shadow evaluation | Sources U03 and U08 | Direct implementation evidence |

## What the evidence does not show

- It does not prove persistent crypto alpha.
- It does not validate the proposed 5–15% or 10–25% ranges for Unimoazi.
- It does not justify online prompt mutation, reinforcement from raw PnL, or retrieval
  across tenants and markets.
- FinMem's equity results are sensitive to model, period, risk profile, and retrieval
  bandwidth; that sensitivity is a reason to gate memory, not a deployment claim.

## Counterevidence and limitations

- Financial outcomes are delayed, noisy, and regime-dependent.
- A profitable outcome can follow a bad decision; a loss can follow a well-calibrated
  decision.
- Retrieved cases can leak future information into replay.
- Nearest-neighbor similarity can retrieve superficially similar but causally
  different regimes.
- Repeated generated lessons can amplify the same model-family bias.
- Sparse markets may never reach a defensible sample size.

## Evidence freshness

The papers and repository behavior were checked on 2026-08-05. Revalidate the
Timescale schema, outcome-maturation code, Evaluation Lab assets, and active prompt
bundle lifecycle before implementation.
