# Evidence

| Claim | Evidence | Status |
| --- | --- | --- |
| Current critical comparisons use unrelated process clocks | U26 | Repository evidence |
| Distributed systems can expose time uncertainty explicitly | S114 | Production-systems research |
| Logical order is distinct from physical time | S115 | Production documentation |
| Hyperliquid nonces require signer-scoped coordination | S116 | Production documentation |
| Authenticated time exchange does not remove uncertainty | S117 | Internet standard |
| Venue actions can carry explicit expiry semantics | S46 | Production documentation |

Sources are registered in [SOURCES.md](../../SOURCES.md).

The evidence supports explicit domains, intervals and protocol-specific nonces. It
does not give Unimoazi TrueTime, make NTS authoritative, or extend one product's
ordering guarantee across services.

## Limitations

- A synchronized clock source can still be wrong.
- Narrow uncertainty bounds may hurt availability; broad bounds may block near expiry.
- Chain timestamp is not finality and UTC order is not causality.
- Venue nonce windows and pruning behavior can change.
- Durable nonce allocation adds storage/coordination work.

S114 is production research, S46/S115/S116 product documentation, S117 a standard,
and U26 repository evidence. Sources were checked on 2026-08-05. Domain, health,
nonce-policy and decision versions bind each receipt.

No percentage incident reduction, universal ordering or clock-accuracy guarantee is
supported.
