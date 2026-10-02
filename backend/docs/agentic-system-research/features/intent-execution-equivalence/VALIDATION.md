# Validation and Promotion

## Local implementation boundary

The implemented slice uses checked-in inert fixtures and no network. The acceptance
thresholds below are promotion gates, not claims that local fixture coverage enables
signing or dispatch. Live validation requires a new explicit, cost-disclosed approval.

## Baseline and datasets

Baseline the current coarse sidecar checks. Use official command examples, locally
generated Universal Router/Permit2 calldata, GMX recorded fixtures and pinned local
state. No funded, deployed or paid-provider test is authorized.

## Experiments

- Golden decode and receipt hashes across TypeScript/Python boundary fixtures.
- Mutate target, recipient, asset, amount, deadline, minimum output, value, nonce,
  domain, selector, allow-revert bit, subplan, permit spender and postcondition.
- Inject unknown selectors, excessive nesting/count/bytes/gas, dynamic recipients,
  decoder exceptions and incomplete state deltas.
- Compare pinned versus implicit-latest behavior and prove implicit-latest is rejected.
- Change every dependent route/quote/policy/consent/capability/certification/context
  hash after receipt generation.
- Race the signing request and dispatch artifact; exact parity must hold.

## Acceptance thresholds

- 100% of submitted artifacts possess a fresh `pass` receipt.
- 100% hash parity between receipt, Particle/Magic signing request and dispatch.
- 100% detection of every required seeded semantic mutation.
- Zero unknown or incompletely decoded operation passes.
- Same frozen bytes, context and versions reproduce the same receipt hash.
- 100% invalidation on any dependent artifact/context/approval drift.
- p95 latency remains inside the artifact/quote validity budget.

The 80–99% hypothesis is reported only after measuring baseline detectable prepared
mismatches and a preregistered mutation corpus. Report prevented mismatches and false
blocks separately; do not extrapolate to losses.

## Promotion, demotion and kill criteria

Promote one exact command/operation family after full decode coverage, mutation,
postcondition, drift and timing thresholds pass. Demote on decoder/native disagreement,
unexpected delta, unsupported command or hash race.

Kill or redesign if an API summary substitutes for bytes; simulation uses implicit
`latest`; unsupported operations warn instead of block; a model participates; or the
receipt becomes reusable authorization.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
