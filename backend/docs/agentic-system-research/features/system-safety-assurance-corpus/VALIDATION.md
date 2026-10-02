# Validation — System Safety Assurance Corpus

## Harness self-tests

- Fixed corpus/version/seed produces identical scenario list, mutation set, artifact
  hashes, coverage matrix and verdict.
- A known failing oracle is reported unsupported, not converted to a harness error.
- Inject irrelevant/equivalent mutants and verify explicit adjudication rather than
  silent exclusion.
- Crash/retry/shard reordering cannot duplicate or lose artifacts.
- Network/provider/venue/signer access is denied and detected.
- Secret and tenant sentinels never cross fixture boundaries or appear in artifacts.

## Release thresholds

| Gate | Threshold |
| --- | ---: |
| Critical claim has owner, oracle, positive case, relevant negative mutations and current artifact | 100% |
| Critical non-equivalent mutant killed | 100% |
| Overall targeted non-equivalent mutation kill rate | >=85% |
| Previously killed critical-mutant regression | 0 |
| External network/provider/venue/signer/wallet call | 0 |
| Real worktree/customer/tenant/secret mutation or leak | 0 |
| Reproducible corpus/seed/verdict hash | 100% |

Any surviving critical mutant makes its claim `unsupported` or `incomplete` regardless
of aggregate score. Expired/mismatched code, schema, invariant, or corpus hash is
`stale`.

## Cost and performance

Record pack/mutation count, CPU, memory, storage, p50/p95 case time and total wall time.
Use deterministic change-scoped packs for normal work and an explicitly started local
full run. Establish an engineering runtime ceiling before adoption; never drop critical
cases to meet it silently.

## Kill criteria

Kill the feature if it labels the product safe/certified, uses a model as an oracle,
duplicates business/policy logic, lets a composite score activate/promote/configure,
silently excludes survivors, mutates the actual worktree/external services, permits
network/paid-provider/wallet access, or cannot reproduce results.

This dossier authorizes no cloud CI. Any potentially billable runner requires separate
cost disclosure and explicit approval.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
