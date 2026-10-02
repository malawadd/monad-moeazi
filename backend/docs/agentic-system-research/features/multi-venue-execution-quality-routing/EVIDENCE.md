# Evidence — Multi-Venue Execution-Quality Routing

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Unimoazi already models allowlists, listing, leverage, minimum notional, staleness, depth, slippage, fees, impact, and funding | Source U09 | Direct implementation/documentation evidence |
| Some current venues use proxy data and should not be called executable | Sources U04 and U09 | Direct project status evidence |
| Quote simulation and freshness help but do not guarantee onchain success | Uniswap sources S20 and S21 | Production API documentation |
| Price impact differs from settlement-window slippage | 0x source S22 | Production integrator guidance |
| Order-book consumers must handle disconnect/reconnect and sequence recovery | Hyperliquid and Lighter sources S23 and S24 | Production API documentation |

## Unimoazi-specific inference

The main value comes from connecting existing routing to proposal/execution and adding
account-specific, exact, versioned evidence. External venue docs validate data shapes
and failure modes, not a percentage cost improvement.

## Counterevidence and limitations

- A fresh exact public book is not necessarily an executable account quote.
- Simulation cannot eliminate MEV, latency, hidden liquidity, partial fills, or venue
  failure.
- Cross-venue funding, collateral, margin, settlement, and product units are not
  directly comparable without adapter normalization.
- Fill-probability estimates can be poorly calibrated and should not enter production
  ranking before separate validation.
- Current private signing and several venue paths remain certification-gated.

## Evidence freshness

Sources were checked on 2026-08-05. Venue APIs, fee schedules, rate limits, and current
repository adapter status are especially time-sensitive and must be revalidated before
implementation.
