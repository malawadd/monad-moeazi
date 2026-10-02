# Evidence — Effective Authority Decision

The local fixture uses strict canonical inputs and a 10,000-case deterministic
adverse-mutation test. This is implementation evidence for local reduction only, not
evidence of owner correctness, execution readiness, or customer comprehension.

## Claim-to-source map

| Claim | Evidence | Strength |
| --- | --- | --- |
| Policy decision and enforcement responsibilities should remain distinct | OPA deployment, source S42 | Production architecture analogy |
| AI systems benefit from lifecycle accountability, transparency, and measurement | NIST AI RMF, source S43 | Voluntary governance guidance |
| Authorization under changing state requires consistent version/ordering semantics | Zanzibar, source S44 | Production systems research analogy |
| Unimoazi already defines effective authority and emits some flat policy checks | Sources U01, U03, and U06 | Direct project evidence |
| Current execution inputs are not yet fully authoritative | Source U07 | Direct implementation evidence |

## Evidence boundaries

OPA's decision/enforcement model, NIST governance, and Zanzibar consistency are
analogies. None implements this trading projection or proves customer comprehension.
The projection cannot correct bad gate inputs or prevent market/execution failure.

## Counterevidence and limitations

- Explanations drift when new gates are added without registry coverage.
- Safe copy can oversimplify remediation or imply certainty.
- A correct snapshot can become stale immediately.
- Complete trace coverage does not prove users understand it.
- `SUBMISSION_ELIGIBLE` can be mistaken for guaranteed submission/fill.

## Evidence freshness

Sources and current policy/execution code were checked on 2026-08-05. Revalidate every
gate owner and product status phrase before implementation.

## Local implementation evidence

The checked-in fixture corpus independently asserts all 26 scenario outputs,
including capability, phase, coverage, ordered reason codes, observed mutation, and
the fixed non-authorizing fields. A fixed-seed 10,000-case property run covers status
and ceiling worsening, required-gate removal, time advance, provenance/source-version
drift, duplicate/fork lineage, rollback, and input permutation. The local 50-write
repository measurement was p95 43.722 ms. These are host-specific engineering results,
not performance, owner-correctness, or execution-readiness claims.
