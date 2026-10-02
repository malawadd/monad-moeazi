# Validation and Promotion

## Corpus and experiments

- Inventory every enabled sink; unknown sinks block.
- Generate tagged synthetic secrets, PII, wallet-like values and benign near-matches.
- Fuzz nested JSON, renamed keys, arrays, binaries, Unicode, URLs, errors, traces and
  truncation boundaries.
- Scan mock Timescale, Convex, Redis, Temporal, logs, providers and export sinks.
- Advance clocks through expiry; inject cache/index/replica/backup/provider partial
  deletion, restarts and policy-version drift.
- Verify onchain references always return `public_onchain`.
- Compare minimized versus existing frozen replays for safety/audit sufficiency.

## Acceptance thresholds

- 100% of enabled persistence/export paths invoke the boundary.
- Zero prohibited corpus fields persist or export; tenant-crossing escapes are zero.
- Identical input/classification/policy produces an identical decision hash.
- 100% of deletion receipts enumerate known copies and disclose unknown/unverifiable
  copies rather than asserting success.
- Expiry never destroys evidence under an explicit current hold/retention policy.
- Mandatory audit-field coverage remains 100%; safety replay is non-inferior.
- Sanitizer p95 and throughput stay within measured budgets.

The 30% byte and 50% restricted-copy hypotheses are reported only with baseline,
denominator and confidence. Unknown formats are not counted as proven-safe.

## Promotion and kill

Promote sink by sink, beginning with prohibited-field blocking. Demote on any escape,
tenant leak, false deletion outcome or required-safety-field loss.

Kill or redesign if post-storage scrubbing is primary; hashes are called anonymous;
secret fingerprints persist; retention is model-selected; verified deletion is false;
public chain data is called erased; immutable safety evidence is silently deleted; or
a second evidence/trace database appears.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
