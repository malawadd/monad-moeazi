# Evidence — Calibrated Selective Prediction

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Adaptive conformal inference targets long-run coverage behavior under changing distributions | ACI, source S35 | Peer-reviewed research |
| Conformal risk control can calibrate selected monotone bounded losses | CRC, source S36 | Research with explicit assumptions |
| Adaptive methods can target more local behavior under shift | JMLR work, source S37 | Peer-reviewed research including financial-volatility experiments |
| Unimoazi already has multi-horizon forecast and frozen Evaluation Lab stages | Sources U03 and U08 | Direct implementation evidence |

## Required caveats

- Ordinary conformal guarantees depend on exchangeability assumptions that serial,
  overlapping, regime-shifting market observations do not safely satisfy.
- ACI targets marginal time-averaged coverage, not per-market, per-regime, per-side, or
  individual-trade correctness.
- Prediction coverage does not include fees, slippage, policy, or counterfactual trade
  outcome unless those are modeled and scored separately.
- No source demonstrates conformal trading alpha or the proposed percentage benefits.

## Counterevidence and limitations

- Labels arrive late and overlap by horizon.
- Small strata create unstable intervals or complete abstention.
- Model/prompt selection changes the residual distribution.
- Intervals can widen until they have no trading utility.
- A system can appear safer by abstaining on everything.

## Evidence freshness

Research and the current Evaluation Lab were checked on 2026-08-05. Revalidate outcome
definitions, forecast horizons, and configuration versioning before implementation.

The local fixture slice does not revalidate these sources or establish a calibration
benefit. Its Feature 30/31/36 lineage is explicitly `requires_revalidation`.
