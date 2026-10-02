# Evidence — Authoritative Risk Snapshot and Reconciliation Receipt

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| The current policy surface already checks volume, exposure, loss, drawdown, positions, credits, quorum, evidence, venue health, and reconciliation | Unimoazi `policy.py` and source U06 | Direct implementation evidence |
| Several of those inputs are placeholders at execution time | Unimoazi `execution_workflow.py` and source U07 | Direct implementation evidence |
| Unimoazi already has typed proposals, decisions, fresh quotes, preflight, idempotency, isolated execution, and traces | Sources U02, U04, U06, and U07 | Direct implementation evidence |
| Gateway-only execution can keep strategy processes free of secrets | Almanak source S06 | Production documentation; transferable architecture pattern |
| Explicit blocked/emergency/failure lifecycle states improve operational clarity | Giza source S07 | Production documentation; not proof of safe execution |
| Typed action schemas narrow an onchain capability surface | AgentKit sources S09 and S10 | Production documentation; direct model access is not transferable |

## Unimoazi-specific inference

The feature is justified primarily by repository evidence, not by third-party results.
External systems show that typed intent, gateway isolation, and explicit lifecycles are
practical patterns. The Unimoazi audit shows the more precise need: authoritative
policy inputs and reconciliation evidence inside the existing execution path.

## Counterevidence and limitations

- A complete snapshot does not prove the underlying venue data is correct.
- Atomic reservation cannot prevent losses caused by price movement, MEV, venue bugs,
  chain reorgs, or signer compromise.
- Strict Pydantic proposals already reject malformed payloads; malformed-proposal
  reduction is not a valid benefit claim for this feature.
- A receipt proves trace coverage, not successful or economically correct execution.
- Cross-store reads can still race unless reservation and freshness semantics are
  explicit and tested.

## Evidence freshness

Repository claims reflect the inspected workspace on 2026-08-05. External production
documentation was checked on the same date. Before implementation, re-read the active
execution workflow, Convex schema, Redis controls, gateway, and venue reconciliation
code because these are likely to change.
