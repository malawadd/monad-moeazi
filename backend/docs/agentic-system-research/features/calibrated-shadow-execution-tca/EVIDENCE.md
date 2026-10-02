# Evidence — Calibrated Shadow Execution and TCA Fidelity

## Claim-to-source map

| Claim | Source | Status and limit |
| --- | --- | --- |
| The current Shadow path treats one quote as a complete entry fill | [U11](../../SOURCES.md#unimoazi-sources) | Direct repository evidence; no lifecycle or TCA model exists |
| IOC remainders can cancel and passive/TWAP orders may not fully fill | [S45](../../SOURCES.md#external-sources), [S46](../../SOURCES.md#external-sources) | Official Hyperliquid semantics; not fill-quality evidence |
| Quotes are time-sensitive and simulation does not guarantee onchain success | [S20](../../SOURCES.md#external-sources), [S21](../../SOURCES.md#external-sources) | Official Uniswap API documentation |
| FIFO queue position affects spread capture and adverse selection | [S48](../../SOURCES.md#external-sources) | Conventional LOB model/backtest; queue remains unobservable without suitable data |
| Execution optimizes costs under uncertain volume | [S47](../../SOURCES.md#external-sources) | Narrow scheduling analogy only; it does not validate queue or fill fidelity |

## Evidence classification

- Hyperliquid and Uniswap sources are production documentation. They prove interface
  and venue semantics, not a profitable or calibrated simulator.
- Queue and uncertain-volume sources are research/backtest evidence. They motivate
  explicit uncertainty but do not provide crypto parameters.
- Unimoazi code is production-intent repository evidence of the current simple path;
  live private signing and certification remain gated.

## Required terminology correction

Use observability grades:

- `QUOTE_AT_TIMESTAMP`: exact payload at capture time, never an exact fill.
- `SEQUENCE_COMPLETE_REPLAY`: complete observed sequence for displayed mechanics;
  passive queue, own impact, hidden flow, and counterfactual reactions may be unknown.
- `DEPTH_APPROXIMATION`: observed depth without sequence-complete reconstruction.
- `PROXY_INDICATIVE`: public proxy that cannot support promotion or live eligibility.

No grade replaces matched certified actual execution receipts.

## Counterevidence and limitations

- Book replay cannot identify an order's passive queue position without order-level
  data and venue rules.
- Historical state omits the strategy's counterfactual market impact, hidden liquidity,
  MEV, sequencer inclusion, competing flow, and cancel timing.
- Approved live executions are selected rather than random and can bias calibration.
- Fee, rebate, funding, gas, margin, and contract schedules drift by version and time.
- A simulator can remove optimism by becoming too pessimistic; signed error, absolute
  error, fill calibration, tails, and no-fill opportunity must be reported separately.

## Freshness

Sources were checked on 2026-08-05. Venue/API semantics require revalidation before a
later implementation. Any changed order, quote, routing, fee, or funding contract
creates a new adapter/simulator version and invalidates incompatible scorecards.
