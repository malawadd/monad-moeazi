# Evidence — Cross-Layer Dependency Safety Envelope

## Claim-to-source map

| Claim | Source | Status and limit |
| --- | --- | --- |
| Current authority uses coarse `system_healthy` and incident behavior is distributed | [U15](../../SOURCES.md#unimoazi-sources) | Direct repository/runbook evidence |
| An open breaker can suppress calls likely to repeat a failure | [S55](../../SOURCES.md#external-sources) | Production architecture guidance, not trading proof |
| Retry/load feedback can create cascading failures | [S56](../../SOURCES.md#external-sources) | Production SRE guidance |
| Timeout, retry, throttling and degradation require explicit mitigations | [S57](../../SOURCES.md#external-sources) | General cloud guidance; no Unimoazi operation matrix |

## Repository-specific gap

Independent health endpoints, optimistic initial execution flags, a Boolean authority
input, and manual runbook rules do not produce one canonical answer to: “May this
account reconcile, render, analyze, propose, request approval, preflight, or submit
given these exact scoped failures?” No owner currently supplies fresh receipts, durable
latches, and recovery rules across that matrix.

## Counterevidence and limits

- EAD already projects owner gates, risk snapshots own authoritative account state,
  run planning owns analysis work, Evidence Fabric owns source freshness, and promotion
  owns configuration quality. A safety envelope must consume, not duplicate, them.
- A breaker can worsen an incident if its scope is too broad, probes add load, or a
  recovered dependency flaps.
- A single success does not prove recovery. Clock skew and stale TTLs can falsely open
  or close a lane.
- “Graceful degradation” is operation-specific. Lower analytical quality must not
  become lower quorum or continued execution authority.
- The 30–60% retry range has no Unimoazi incident baseline and remains a hypothesis.

## Freshness

Sources were checked on 2026-08-05. Dependency owners, health endpoints, runbook rules,
and execution certification must be re-audited before implementation. Matrix changes
create a new version and invalidate outstanding decisions at affected boundaries.
