# Design — Deterministic Evidence-Delta Triage and Run Planning

## Phase-1 production contract

Only two production decisions are allowed:

- `skip`: record no material change and do not call providers;
- `full_run`: execute the complete current Focus/Pro/Max plan under the activated
  configuration.

A skip does not update the prior analysis `created_at`, `valid_until`, or imply a new
snapshot. Product UI may show the skip time and reason separately from snapshot age.

## Proposed contracts

### `EvidenceDelta`

- previous/current replay-manifest IDs and hashes;
- changed source families/events, quality/freshness transitions, and source watermarks;
- deterministic magnitude/materiality features;
- current position/risk/reconciliation/venue-health override state;
- observed/cutoff time, detector/materiality versions, and hash.

### `TriageResult`

- `skip | full_run | evaluation_staged`;
- input/policy/configuration hashes and expiry;
- material, unknown, stale, high-risk, maximum-staleness, and budget reason codes;
- expected customer-visible consequence;
- pure deterministic evaluator version.

Any unknown/stale detector state, high-risk position, material event, maximum-staleness
deadline, unresolved reconciliation, or policy-defined critical source transition
forces `full_run` or a deterministic block—not skip.

### `PlannedSlot`

- slot/role/stage and `required | optional | escalation` classification;
- exact activated route reference, provider/model, prompt/schema version;
- dependencies/prerequisites, timeout, maximum input/output tokens, expected and
  maximum cost/credits;
- quorum/family contribution and failure behavior.

### `RunPlan`

- job/manifest/profile/tier/configuration identity and hashes;
- ordered/parallel slot graph and existing tier requirements;
- expected/maximum calls, tokens, provider cost, credits, latency deadline;
- full reserved maximum and reservation IDs;
- escalation ceiling, planner/policy version, created/expiry time.

The planner cannot choose a provider/model absent from the activated configuration.
Any revision change before execution invalidates the plan.

## Phase-1 flow

1. An idempotent cadence/material trigger provides the current and prior manifests.
2. Build `EvidenceDelta` and apply source quality/materiality policies.
3. Check high-risk positions, emergency/reconciliation state, maximum snapshot age,
   customer authority, Manual Guard, and budget state.
4. Emit and durably store `TriageResult`.
5. On skip, store a no-change trace and return without provider calls or snapshot
   refresh.
6. On full run, build every slot required by the existing tier and activated route.
7. Calculate expected and complete maximum spend; reserve credits/BYOK/global capacity
   before dispatch.
8. Recheck profile/configuration/runtime revision, then execute the exact plan.
9. Record planned versus actual calls, tokens, cost, latency, outcomes, and all failures.

## Existing tier guarantees

- Focus retains six assignments and four-valid-specialist minimum.
- Pro retains twelve base roles, duplicated critical roles, critic/synthesis, eight
  valid reports, every critical role, and two canonical families.
- Max retains its full role/duplication/two-synthesis/arbiter structure, fourteen valid
  reports, critical roles, and two canonical families.
- Lite Mode remains the existing development clamp and cannot be selected as a
  customer-cost optimization.

## Evaluation-only staged plans

Later Evaluation Lab subjects may test reduced slots or bounded escalation only when:

- the role/source eligibility contract is frozen;
- the complete maximum path is reserved;
- escalation follows a fixed graph and uses only activated routes;
- failure to meet the staged condition falls back to the full plan inside the same
  maximum or returns abstain;
- customer tier labeling is not reused for a reduced contract.

Any successful staged design requires a newly versioned customer-facing tier contract
and separate approval before production.

## Storage and monitoring

- Timescale stores deltas, triage, plans, slot events, skipped decisions, and detailed
  usage/outcomes.
- Convex stores current job state, no-change summary, snapshot age, and bounded cost
  summary.
- Redis coordinates trigger dedupe and atomically reserves maximum budgets.
- Temporal owns the durable run.

## Failure behavior

- Unknown/stale delta: full run or block according to freshness; never skip.
- Simultaneous triggers: coalesce to one idempotent plan and preserve causes.
- Route/config drift: invalidate before provider dispatch.
- Budget unavailable: do not start; no partial unreserved plan.
- Provider failure: existing quorum rules apply; no unconfigured fallback.
- Late escalation beyond remaining budget/deadline: abstain/degrade, never exceed.

## Later implementation sequence

1. Add phase-1 contracts and replay-only triage.
2. Establish missed-event and quiet-demand baselines.
3. Run skip/full-run Shadow A/B with complete tier plans.
4. Enable production no-change decisions after non-inferiority acceptance.
5. Add evaluation-only staged plans after source contracts exist.

Rollback disables skip decisions and returns every eligible trigger to the current full
tier path; stored no-change traces remain auditable.
