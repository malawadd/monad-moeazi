# Validation and Promotion

## Baseline and corpus

Inventory every current executable target, proxy relationship, ABI/domain, adapter,
SDK/image and configuration source. The baseline is current venue flags, allowlists
and isolated hook checks. Build local or recorded fixtures; do not call paid RPCs,
deploy or submit transactions.

## Experiments

- Resolve direct, transparent/UUPS proxy, beacon and deliberately nonstandard cases.
- Mutate implementation, admin, beacon, runtime hash, domain, selector/schema, token
  config, hook permissions/pool identity, adapter, SDK and image identity.
- Inject missed events, reorgs, stale caches, partial observations and expiry.
- Prove drift invalidates routes, capability decisions and equivalence receipts.
- Prove only a separately certified close/reconciliation set survives risk-path drift.
- Reproduce decisions from the same frozen observations and versions.

## Acceptance thresholds

- 100% of executable targets and transitive dependencies resolve under a current spec.
- Zero unresolved proxy/beacon/admin topology passes.
- Zero new preparation or submission occurs under unknown, expired or drifted state.
- 100% of dependent artifacts are invalidated on seeded drift.
- 100% deterministic decision/hash reproduction from frozen inputs.
- Detection latency, false blocks and added p95 latency are reported per artifact cell.

The 60–95% incident-reduction hypothesis is evaluated only against a preregistered
stale-integration fault set with an explicit denominator. Production reporting begins
with stale-artifact blocks, invalidation coverage, detection latency and false
`close_only` activation.

## Promotion and demotion

## Local validation boundary

The local fixture corpus validates deterministic behavior only. It does not promote
the product or authorize live validation; any future external validation needs its own
approval and applicable cost disclosure.

Promote one exact artifact/operation set after topology coverage, mutation detection,
safe-close and latency thresholds pass. Demote immediately on an unexplained native
observation, missed dependency invalidation, unsafe continuing preparation or registry
ownership conflict.

## Kill criteria

Kill or redesign if a venue flag or code hash is treated as sufficient; proxy admin or
implementation state is ignored; Redis becomes authoritative; drift blocks necessary
reconciliation; re-certification is automatic; or capability state is duplicated.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
