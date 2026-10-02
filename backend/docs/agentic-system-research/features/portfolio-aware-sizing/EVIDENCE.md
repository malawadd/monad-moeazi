# Evidence — Portfolio-Aware Sizing and Trade Construction

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Reducing exposure during high-volatility periods can improve historical risk-adjusted outcomes | Volatility-Managed Portfolios, source S17 | Peer-reviewed conventional-finance research |
| Sample covariance error destabilizes portfolio optimization and shrinkage can reduce estimation error | Ledoit-Wolf, source S18 | Statistical/portfolio research |
| Turnover penalties and regularization matter under transaction costs and model uncertainty | Source S19 | Peer-reviewed historical research |
| Unimoazi already has deterministic per-proposal policy ceilings but lacks authoritative aggregate inputs in execution | Sources U06 and U07 | Direct implementation evidence |

## What transfers

- Volatility should reduce allowed risk rather than increase it.
- Correlation estimates need shrinkage, quality checks, and stress scenarios.
- Costs and turnover belong inside the feasibility decision.
- Hard policy caps remain primary even when an optimizer suggests another result.

## What does not transfer

- Published factor-portfolio effect sizes.
- A particular volatility window, covariance estimator parameter, expected-return
  estimate, or leverage multiplier.
- Claims of lower actual loss or higher returns in crypto/perpetual markets.

## Counterevidence and limitations

- Correlations rise and liquidity falls during stress.
- Crypto return distributions, funding, liquidation mechanics, and fragmented
  collateral differ from conventional portfolios.
- Expected returns are much noisier than risk/cost estimates.
- An optimizer can create concentrated or high-turnover solutions when inputs are
  unstable.
- Incorrect units or stale positions can defeat otherwise correct mathematics.

## Evidence freshness

External papers and current Unimoazi code were checked on 2026-08-05. Revalidate all
position, collateral, venue contract, and history sources before implementation.
