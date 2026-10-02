# Evidence — Deterministic Run Planning

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| LLM cascades can trade cost against benchmark quality | FrugalGPT, source S31 | Research/benchmark |
| Learned routing can choose between stronger/weaker models | RouteLLM, source S32 | Research/benchmark |
| Strict structured output improves schema adherence | Source S33 and Unimoazi strict contracts | Production capability plus local implementation |
| Unimoazi already has fixed tiers, activated routes, quorum, Lite caps, and finish-safe evaluation plans | Sources U03, U05, and U08 | Direct implementation evidence |

## Evidence boundaries

FrugalGPT and RouteLLM operate under substantially looser routing assumptions than
Unimoazi. Their savings are not transferable to financial, quorum-sensitive,
strict-schema workflows. Structured output validates shape, not analytical adequacy.

## Counterevidence and limitations

- False no-change decisions can miss fast or gradual material events.
- Savings disappear when most demand is material or high risk.
- Skipping work can make a stale snapshot look current if timestamps are mishandled.
- Adaptive role omission would change the meaning of existing customer tiers.
- Dynamic learned routers drift and weaken reproducibility.

## Evidence freshness

Sources and current tier/routing code were checked on 2026-08-05. Revalidate tier
contracts, Lite Mode, cost reservation, and route activation before implementation.
