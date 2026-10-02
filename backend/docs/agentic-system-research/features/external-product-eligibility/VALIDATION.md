# Validation and Promotion

Use synthetic account/product/jurisdiction matrices, effective/expiry boundaries,
source additions/removals/delays, conflicting rules, missing/disputed assertions,
ambiguous matches, attribute expiry, product-version/jurisdiction change, tenant
isolation and concurrent tightening/loosening activation.

## Thresholds

- 100% parity with counsel-reviewed frozen golden vectors before activation.
- Zero positive decisions with missing/stale/conflicting/wrong-scope assertions.
- 100% positive results bind exact rulepack/source/assertion/product hashes.
- Zero LLM participation, inferred jurisdictions or authoritative hidden name matching.
- Zero loosening without legal re-review and Safety Change Quorum.
- Identical inputs/versions produce identical decision hashes.

Measure rule coverage, unknown/manual-review and inconsistent-decision rates only. Do
not project regulatory-risk reduction.

Keep permanently design-only if no qualified owner exists, applicability needs
case-by-case judgment, attributes lack lawful reliable sources, false-match review is
unsafe or updates miss freshness. Kill for marketing as legal advice/compliance,
autonomous interpretation, technical-signal identity inference, excess PII, absent
pack as eligible, or eligibility authorizing execution.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.

## Local fixture checks

The implementation checks the closed 90-case corpus, 196 operation-matrix cases,
36 venue-matrix cases, and 10,000 fixed-input replay cases. The evaluator benchmark
uses the typed pure evaluator; separate opt-in disposable PostgreSQL harness and SQL
checks verify retry, conflict, rollback, readback, migration rerunnability, and
append-only constraints. These checks do not validate legal applicability.
