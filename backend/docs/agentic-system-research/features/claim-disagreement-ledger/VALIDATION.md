# Validation — Claim-Level Disagreement Ledger

## Dataset

Build a versioned human-adjudicated corpus from frozen replay cases and existing six
adversarial categories. Add cases for:

- same claim with paraphrased wording;
- opposite direction at the same and different horizons;
- same-family agreement presented through different gateways;
- stale, duplicated, circular, and low-quality evidence;
- neutral claims, missing falsifiers, and conflicting magnitude ranges;
- valid disagreement caused by genuinely uncertain evidence.

At least two reviewers label conflict membership, materiality, and whether a final
answer addressed the conflict. Resolve reviewer disagreement before freezing the test
set. Keep a chronological held-out set.

## Experiment subjects

1. Current orchestration champion.
2. Ledger-only challenger with unchanged call topology.
3. Ledger plus conditional escalation challenger.

All subjects receive byte-identical frozen evidence. Route, prompt, grouping-rule,
and cost versions are immutable. Compare Focus, Pro, and Max separately.

## Metrics

- critical-conflict recall and overall conflict precision;
- material conflicts addressed, unresolved, or correctly causing abstention;
- evidence grounding and wrong-market leakage;
- Brier score, log loss, and ECE when forecast outputs exist;
- proposal direction changes and false-positive proposal rate;
- input/output tokens, provider cost, end-to-end latency, and invalid-output rate;
- results by market, regime, horizon, role, tier, and canonical model family.

## Promotion thresholds

Ledger visibility may advance when the held-out corpus shows:

- at least 95% recall for material critical conflicts;
- at least 85% overall conflict precision;
- 100% trace linkage for material groups;
- at least 15% relative reduction in unaddressed material conflicts, with a bootstrap
  confidence interval excluding no improvement;
- no more than two percentage points of grounding-score regression;
- no statistically material forecast-calibration or safety regression.

Conditional escalation is a separate promotion. It also requires:

- non-inferior contradiction handling and forecast calibration per tier;
- at least 10% net expected token or provider-cost reduction for the affected tier;
- p95 latency no worse than the frozen maximum-latency budget;
- maximum calls and maximum spend unchanged or lower and fully pre-reserved.

If the corpus is too small to support these statements, the result is `hold`, not a
weaker threshold.

## Kill criteria

- Any weakening of critical-role or model-family quorum.
- Any model-decided grouping/materiality step in the execution path.
- Any unresolved material conflict presented as resolved.
- Any cross-market evidence leakage or hidden reasoning capture.
- Unpreviewable conditional spend or call count.
- A conditional path that cannot replay deterministically from frozen inputs.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
