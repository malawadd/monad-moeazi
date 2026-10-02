# NautilusTrader 1.231.0 offline comparison, 2026-09-30

This is a bounded Stage 3 component decision. The installed isolated Windows CPython
3.12 artifact is NautilusTrader `1.231.0`, `LGPL-3.0-or-later`, wheel SHA-256
`0697f51e9143f9d8d040f75d2e6a45218003cc34f7ea5b0eb2f9cda6935427de`.
The ignored environment is `.data/nautilus-1.231`; the exploratory probe is
`.data/q4-nautilus-probe.py`, and the reproducible, assertion-backed L2 case is
[`scripts/qualify-nautilus-1231.py`](../../../scripts/qualify-nautilus-1231.py).
Run it with `.data/nautilus-1.231/Scripts/python.exe scripts/qualify-nautilus-1231.py`.
It uses only local test-kit instrument definitions,
synthetic order books/quotes and an offline `BacktestEngine`. No market, account,
provider, signing, network or paid call occurred. Installation provenance is in
[engine qualification preparation](engine-qualification-preparation.md).

## Actual observed comparison

The probe creates a CASH `BINANCE` venue, a test-kit ADA/USDT instrument with
0 or 10 basis-point maker/taker fee, 10,000 USDT initial wallet, a buy for
0.7 ADA at 100 USDT and one 0.3 ADA visible ask. It runs the installed v1 API:
`BacktestEngine.add_venue`, `add_instrument`, `add_strategy`, `add_data`, `run`.

| Offline case | Expected arithmetic | Observed engine event and wallet |
| --- | --- | --- |
| L1 quote, zero fee, ask size 1 | Buy 0.7 at 100, pay 70 | Fill 0.7 at 100; ADA 0.7, USDT 9,930 |
| L1 quote, 10 bp | Fee 0.07 USDT | Fill 0.7 at 100, commission 0.07; USDT 9,929.93 |
| L1 quote, ask size 0.3 | Depth-limited model would leave 0.4 | Engine instead filled 0.3 at 100 then 0.4 at 100.0001 in the same tick; L1 is unsuitable as a visible-depth oracle |
| L2 book, liquidity consumption, 10 bp, market GTC | Visible 0.3 fill, 0.03 fee; 0.4 residual | Fill 0.3 at 100, commission 0.03; ADA 0.3, USDT 9,969.97. A later cancel request was rejected `ClientOrderId ... not found` for the market residual |
| L2 book, liquidity consumption, 10 bp, **resting limit GTC** at 100 | Fill 0.3, 0.03 fee; cancel 0.4 residual | `OrderAccepted`, `OrderFilled` 0.3 at 100 with 0.03 fee, `OrderPendingCancel`, `OrderCanceled`; ADA 0.3, USDT 9,969.97 |

The market residual cancellation result is a model semantic boundary, not evidence
that Nautilus cannot cancel orders: the resting limit test cancels successfully.
The L2 case provides a useful narrow comparator for partial fills, fees and
cancellation. It does **not** cover Moeazi's independent BTC/USDC/ETH third-asset
fee oracle, linear-perpetual funding/margin, crash recovery, reservation fencing,
or source-proofed journal effects. Those remain in Moeazi's exact source and
financial tests.

## Precision, time and authority boundaries

The installed build exports `FIXED_PRECISION=9` and `HIGH_PRECISION=False` from
`nautilus_trader.model.objects`. This **specific artifact** cannot exactly model
Moeazi assets requiring 18 decimal places; it is not a claim about every build.
The v1 engine source sorts added data by `ts_init` (`backtest/engine.pyx`, around
line 903). Its sort is not a proof that an observation was available at the
decision cutoff. Moeazi's immutable `event_at`, `available_at`, evidence cutoff,
source rights and accepted snapshot checks remain separate preconditions.
Moeazi's Q4 run coordinator checks aggregate fills against each frozen visible
book level. When two orders would consume more than that level's declared
participation, it rejects the replay instead of allocating residual depth or
estimating venue queue priority. This is a fail-closed model limit, not a claim
of CLOB venue parity.

**Disposition:** retain Nautilus only as an optional isolated offline comparator
for <=9-decimal CLOB examples. Do not add it to the production dependency set or
use its account balances as the financial ledger. Moeazi's versioned simulator
events, SQL journal, reservation/protection state and source admission retain
authority. A broader engine decision needs exact 18-decimal capability, validated
availability mapping, third-asset fees, linear-perp parity and durable lifecycle
comparison against the frozen Q4 corpus.
