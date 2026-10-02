# Evidence

## Claim-to-source map

| Claim | Evidence | Status |
| --- | --- | --- |
| Current architecture lacks a canonical collateral dependency/exit envelope | U22 | Repository evidence |
| USDC experienced a temporary depeg after disclosed bank-reserve exposure | S94 | Issuer incident statement |
| USDC is designed around reserve backing and redemption | S95 | Issuer documentation/claim |
| Hyperliquid bridge withdrawals have validator/dispute/lock mechanics | S96 | Production documentation |
| Hyperliquid contracts can combine USDC collateral and USDT-denominated indices | S97 | Production documentation |
| GMX liquidity and redemption depend on market backing, caps and asset risks | S98 | Production risk documentation |
| GMX liquidation value includes fees and price impact | S78 | Production documentation |

Sources are registered in [SOURCES.md](../../SOURCES.md).

## Evidence conclusion

Collateral value, venue liquidation semantics and withdrawal availability are
separate. Historical depeg and venue mechanism evidence justify explicit dependency,
haircut and exit-capacity modeling. They do not provide a universal haircut, current
solvency proof or causal loss-reduction estimate.

## Counterevidence and limitations

- Issuer claims are not independent continuous reserve verification.
- Recorded depth and withdrawal state can change before action.
- Stress policies may be overly conservative or miss correlated failures.
- Cross-venue withdrawal and settlement mechanics are not directly comparable.
- A `reduce_only` label is unsafe without a certified executable route.

## Classification and freshness

S94 is an official incident statement; S95 is an issuer claim; S96–S98 and S78 are
production documentation. U22 is repository evidence. Sources were checked on
2026-08-05. Each asset spec and policy stores source/review versions and expiry.

## Claims excluded

No scalar venue-solvency claim, issuer guarantee, immediate-withdrawal promise or
automatic capital-protection claim is permitted. The 20–60% range applies only to
predeclared stress scenarios and must be reported with capital-efficiency cost.
