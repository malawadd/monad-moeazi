# Evidence

## Claim-to-source map

| Claim | Evidence | Status |
| --- | --- | --- |
| Current scalar price fields lack formula/config/account binding | U18 | Repository evidence |
| Hyperliquid mark price combines documented oracle and market inputs and drives liquidations | S74, S75 | Production documentation |
| Oracle compromise or manipulation remains a venue risk | S76 | Official risk disclosure |
| GMX uses directional min/max oracle prices and separates display/funding semantics | S77, S79 | Production documentation |
| Liquidation depends on fees, price impact and position/account state | S78 | Production documentation |
| Routing adapters may expose proxies where exact private preparation is incomplete | U04, U09, U18 | Repository evidence |

Sources are registered in [SOURCES.md](../../SOURCES.md).

## What the evidence establishes

The sources establish that venue-native price semantics differ and that liquidation
is not a comparison against one portable scalar. They justify explicit semantic
versions, observation sets and account-bound calculations. They do not establish a
universal divergence threshold, continuous availability or accuracy.

## Counterevidence and limitations

- Venue-authored documentation may lag implementation or configuration changes.
- Exact formula parity cannot detect a malicious or compromised native oracle.
- Public endpoints may omit internal components needed for a complete calculation.
- A correct liquidation estimate can change immediately with price, funding, fees,
  collateral or another position.
- Hyperliquid's venue domain and Arbitrum ownership root are different namespaces.

## Evidence classification and freshness

S74–S79 are production documentation or official risk disclosure, not independent
production-outcome evidence. U18 is direct repository evidence. All were checked on
2026-08-05. Each certification stores the source revision, reviewed adapter version,
fixture hash and expiry; expired or changed semantics cannot authorize an increase.

## Unsupported claims explicitly excluded

No source proves this feature improves PnL, prevents all liquidations or validates an
oracle. The 50–90% defect-reduction range is a falsifiable engineering hypothesis
restricted to semantic-mismatch defects observed in replay and Shadow comparisons.
