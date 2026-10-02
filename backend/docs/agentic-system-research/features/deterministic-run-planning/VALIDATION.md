# Validation — Deterministic Run Planning

## Phase-1 comparison

Replay identical chronological triggers through:

1. current cadence/full-run champion;
2. deterministic skip-or-full-run challenger.

When the challenger selects full run, its manifest, slots, routes, quorum, and maximum
must equal the champion for that tier/configuration. Skipped cases mature outcomes so
reviewers can identify missed material events.

## Required scenarios

- no evidence change, exact duplicate, quiet drift, threshold crossing, and event storm;
- unknown/stale delta, source gap/correction, maximum-staleness deadline;
- open high-risk position, emergency stop, reconciliation issue, and venue degradation;
- simultaneous cadence/material triggers and idempotent coalescing;
- route/profile/prompt revision before dispatch;
- provider failure, invalid structured output, late escalation, retry, and budget
  exhaustion;
- skipped run must not refresh snapshot validity.

## Metrics

- provider calls, tokens, cost, and credits per eligible observation;
- time-to-no-change and time-to-full-snapshot reported separately;
- skip rate, missed-material-event rate, maximum snapshot age, and backstop frequency;
- forecast calibration, grounding, contradiction handling, abstention, and simulated
  outcome on full and skipped cohorts;
- quorum/critical-role/family compliance;
- planned versus actual maximum spend and retry/escalation behavior.

## Phase-1 promotion thresholds

- zero full runs omit a configured tier obligation;
- zero plans exceed reserved maximum calls, tokens, cost, or credits;
- zero skipped decisions refresh or extend the prior snapshot;
- missed-material-event rate is non-inferior to the current cadence under the frozen
  safety margin, with no missed critical risk/execution event;
- snapshot age always stays inside the maximum-staleness policy;
- quiet/non-material provider spend falls at least 20% after including backstop runs;
- grounding, calibration, safety, and abstention metrics meet independent
  non-inferiority margins no wider than 2% relative.

The 20–50% spend and 15–40% time ranges remain hypotheses. If quiet demand is too low
or event labels are inadequate, the decision is `hold`.

## Staged-plan gates

Evaluation-only role omission cannot advance unless a new tier contract independently
passes source eligibility, critical-role, family-quorum, calibration, grounding,
safety, cost, and latency gates. Savings alone never promote it.

## Kill criteria

- An LLM selects a route/model/slot or decides materiality.
- Skip occurs with unknown, stale, high-risk, or maximum-staleness state.
- A Focus/Pro/Max production run uses fewer obligations under the same tier label.
- Lite Mode becomes a customer tier.
- A retry or escalation exceeds the frozen reservation.
- Convex polling is introduced.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
