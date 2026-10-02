# Validation — Specialist Source-Value Attribution and Evidence Gating

## Citation tests

- Model cites allowed, unknown, duplicate, cross-market, and cross-tenant IDs.
- Supplied, cited, and supporting sets remain distinct in storage and monitoring.
- Claim-level citations survive synthesis without being replaced by the entire manifest.
- Corrected/superseded evidence follows the manifest cutoff.

## Attribution design

- Paired cases differ only by the selected source-family mask.
- Route, model, prompt, role, evidence-contract, outcome, and strategy versions remain
  frozen.
- Cases are chronological and stratified by market, regime, horizon, and role.
- Use at least 100 mature paired cases per selected stratum as an eligibility floor,
  then require power analysis/effective sample sufficiency.
- Coalition seeds and budgets are deterministic; incomplete plans are labeled.

## Required scenarios

- redundant/correlated feeds and many syndicated copies;
- rare crisis source absent in ordinary periods;
- stale but historically high-value source;
- wrong-market, corrected, poisoned, and missing critical sources;
- model answers from prior knowledge after source removal;
- attribution reversal across model, regime, or horizon;
- source outage concentrated in difficult periods.

## Metrics and promotion thresholds

Freeze independent non-inferiority margins no wider than 2% relative for the primary
forecast/calibration, grounding, safety, and simulated-strategy metrics. A candidate
contract may advance when:

- no critical-role or family-quorum requirement is weakened;
- citation validity and freshness alignment improve with intervals excluding no
  improvement;
- every removed optional family has a non-positive/replaceable held-out contribution
  across required strata or a documented rare-risk retention decision;
- quality metrics meet every non-inferiority margin;
- expected runtime provider cost decreases by at least 10%;
- the finite offline experiment cost and payback estimate are separately reported;
- source/contract drift monitoring and rollback exist.

The 10–30% cost and 30–60% citation ranges remain hypotheses. Production gating stays
held when samples, replay provenance, or citation identity are inadequate.

## Kill criteria

- LLM self-report or citation count is treated as source value.
- Attribution is called causal importance.
- A critical source/role/quorum requirement is waived for cost.
- A source is automatically removed from production.
- Combinatorial evaluation can exceed its frozen maximum.
- Cross-tenant or future evidence enters an ablation.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
