# Evidence

## Local implementation note

The local fixture registry tests deterministic identity and lifecycle invariants; it
does not establish the correctness or freshness of any live venue metadata source.

| Claim | Evidence | Status |
| --- | --- | --- |
| Current string/positional mapping lacks versioned identity/lifecycle | U27 | Repository evidence |
| Conventional standards separate definition, status and actions | S119–S121 | Standard documentation/analogy |
| Hyperliquid IDs depend on instrument class and universe/index rules | S122 | Production documentation |
| Delisting settles/cancels and blocks later new orders | S123 | Production documentation |
| Display and native symbols may be remapped | S124 | Production documentation |
| Frozen and paused states can permit different operations | S125 | Governance design analogy |

Sources are registered in [SOURCES.md](../../SOURCES.md).

The sources establish that symbol and current list position are insufficient identity
and that lifecycle changes require operation-specific behavior. FIX/Aave are data-model
analogies, not legal obligations or universal venue policy.

## Limitations

- Venue lifecycle events may arrive late, conflict or be missing.
- Economic continuity can require human review and remain unknown.
- Crypto rebases/forks/migrations exceed conventional action taxonomies.
- Registry correctness cannot repair an incorrect native venue definition.
- Rebaseline may be expensive and block otherwise harmless work.

S119–S121 are conventional standard docs, S122–S124 venue documentation, S125
governance design, and U27 repository evidence. Sources were checked on 2026-08-05.
Native metadata, event, transform and registry versions bind each decision.

No automatic position conversion, migration, settlement or universal mapping-quality
claim is supported.
