# Validation — Mandate-to-Policy Semantic Fidelity and Change Consent

## Golden clause corpus

Include supported numeric caps, units, markets, venues, modes, cadence, stop/take-profit
requirements and expiry, plus:

- unsupported weekend/news/event rules;
- ambiguous units, missing scope, negation and compound statements;
- contradictory caps and duplicate clauses;
- mixed tightening/loosening changes and boundary values;
- unknown future schema fields and explicit default provenance.

If an optional projector is tested, measure per-clause mapping precision/recall and
status confusion separately. It remains non-authoritative regardless of score.

## Property and fault tests

- Same MandateSpec/compiler/schema produces identical policy/map/diff/test hashes
  across retry and presentation language.
- Exhaustive schema field/boundary mutation has a declared tightening/loosening/
  neutral/unknown result.
- Remove, invert, relax, or silently default each constraint and require block or a
  visible classified diff.
- Stale active revision, wrong user/account, expired/replayed challenge, changed
  mandate/compiler/schema/test/diff hash, concurrent activation and outbox failure.
- Direct UI and text-assisted flows produce identical artifacts from identical typed
  mandates and cannot bypass the compiler.

## Acceptance thresholds

| Gate | Threshold |
| --- | ---: |
| Supported typed-clause compile/map coverage | 100% |
| Clause resolved or activation blocked | 100% |
| Silent-default/unresolved activation | 0 |
| Active policy without current mapping/tests/receipt | 0 |
| Loosening/unknown without fresh exact-hash confirmation | 0 |
| Stale/wrong/replayed/cross-tenant activation success | 0 |
| Model or direct-UI compiler/activation bypass | 0 |

## Kill criteria

Kill the feature if free text or a model becomes policy authority; ambiguity or defaults
can activate; hashes/versions/tests are optional; mixed diffs hide loosening; old
consent can confirm a changed policy; direct UI bypasses the compiler; or long-lived
policy consent is treated as per-trade approval.

All validation is provider-free using fixtures/property tests unless the user later
authorizes a bounded projector experiment. No deployment, CI, wallet, or live policy
activation is authorized by this dossier.

## Baseline, datasets, and sample requirements

The checked-in local corpus exercises compiler coverage, diff directions and synthetic
challenge replay with frozen time. It does not use a provider, signer, network or policy mutation.

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
