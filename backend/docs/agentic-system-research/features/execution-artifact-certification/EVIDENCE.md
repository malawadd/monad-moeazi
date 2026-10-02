# Evidence

## Claim-to-source map

| Claim | Evidence | Status |
| --- | --- | --- |
| Current checks lack one canonical transitive artifact registry | U21 | Repository evidence |
| ERC-1967 separates implementation, beacon and admin slots | S89 | Technical standard |
| GMX publishes deployment addresses and warns integrations change | S90 | Production documentation |
| Uniswap v4 hook permissions are encoded in address bits | S91 | Production documentation |
| Hook integrations require explicit security review | S92 | Production security guidance |
| Proxy upgrade tooling validates patterns and storage relationships | S93 | Production tooling documentation |
| Immutable container digests identify builds, not behavior | S65 | Production documentation |

Sources are registered in [SOURCES.md](../../SOURCES.md).

## Evidence conclusion

Standards and official documentation show that a visible target address is
insufficient identity for proxies, hooks and upgradeable integrations. They support
boundary observation and dependency invalidation. They do not certify semantics,
governance or exploit resistance.

## Counterevidence and limitations

- Nonstandard proxies or opaque hosted APIs may not expose a complete topology.
- A matching code hash can still identify vulnerable or malicious code.
- Event ingestion can miss logs or reorgs and cannot replace boundary reads.
- Image, SDK and git identities do not prove the deployed service used them.
- Re-certification quality depends on human review and complete fixtures.

## Classification and freshness

S89 is a technical standard; S90–S93 and S65 are production documentation or tooling,
not outcome evidence. U21 is current repository evidence. Sources were checked on
2026-08-05. Every certification has an effective time, expiry and review reference;
drift or expiry blocks risk-increasing use until explicit requalification.

## Claims excluded

## Local implementation evidence

The implemented local corpus uses checked-in fixture identities and deterministic
replay only. It provides no live provenance, onchain observation, or production
execution claim; product availability remains unavailable.

The registry cannot claim that a hash proves safety, that every exploit is detectable
as drift, or that incident losses will fall. The 60–95% range is tested only against
an enumerated stale-integration fault corpus.
