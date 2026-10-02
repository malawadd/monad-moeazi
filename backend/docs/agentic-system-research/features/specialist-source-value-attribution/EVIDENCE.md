# Evidence — Specialist Source-Value Attribution

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Marginal contribution can be estimated by evaluating data subsets/coalitions | Data Shapley, source S29 | Peer-reviewed ML research |
| Shapley-style importance is sensitive to dependence, game definition, and reference distribution and is not causal | Source S30 | Peer-reviewed limitations analysis |
| Unimoazi has frozen cases and detailed traces but no source-family ablation | Source U08 | Direct implementation evidence |
| Current report evidence is overwritten with all supplied references | `orchestrator.py` and sources U05/U06 | Direct implementation evidence |

## Evidence boundaries

Data Shapley values training examples in supervised ML. This dossier adapts only the
marginal-contribution idea to inference-time source families. The resulting estimate
is conditional on model, prompt, role, market, regime, horizon, cases, and selected
value function.

## Counterevidence and limitations

- Correlated feeds can split or duplicate value unpredictably.
- Rare crisis evidence can appear valueless in ordinary samples.
- Source outages can bias samples toward easy periods.
- Models may answer from pretrained knowledge when a source is ablated.
- Combinatorial coalitions create large provider cost.
- Citation validity does not prove the claim is true.

## Evidence freshness

Sources and orchestration code were checked on 2026-08-05. The citation handling bug
is a prerequisite observation and must be reverified before implementation.
