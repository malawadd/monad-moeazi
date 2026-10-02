# Validation — Effective Authority Decision

Local checks cover strict hashes, duplicate keys, closed registry, stale/missing
coverage, deterministic adverse mutations, proxy allowlisting and sanitized UI copy.
They do not validate product or authoritative owner parity.

## Truth-table and property tests

- Cover every gate status, customer mode, development safeguard, approval state, and
  execution boundary combination.
- Same unordered GateResult set yields the same decision.
- Adding `fail`, `unknown`, or `stale` can never increase capability.
- Removing a required gate can never increase capability.
- Wrong account/proposal/version/hash is rejected.
- Decision expiry never exceeds its shortest required owner result.
- `SUBMISSION_ELIGIBLE` is impossible without authoritative risk/reconciliation,
  signer/delegation, certification, quote, policy, and reservation receipts.

## Race and parity tests

- Policy/profile/customer mode changes during proposal and approval.
- Emergency stop or Manual Guard changes before dispatch.
- Quote expiry, venue degradation, credential/delegation loss, credit reservation
  change, and reconciliation drift.
- Approval arrives concurrently with proposal expiry.
- Compare the projection with actual gateway disposition across thousands of generated
  fault combinations. Projection authority may be lower, never higher.

## Security and presentation tests

- No secrets, credentials, signed payloads, hidden reasoning, or unsafe raw errors.
- Safe messages distinguish mode, setup, readiness, simulation, preflight, submission,
  confirmation, and reconciliation.
- Customer comprehension/task tests identify the blocker and next safe action.
- Accessibility and mobile layouts retain all blockers without a misleading green
  summary.

## Metrics and promotion thresholds

- 100% enumerated required gates emit fresh results or an explicit unknown/stale result;
- zero property/parity cases project higher authority than enforcement;
- zero uncovered/reducer-version mismatches silently produce a state;
- 100% decisions bind complete input IDs/hashes and `non_authorizing` semantics;
- zero redaction/no-CoT violations;
- establish ambiguous-support/debug baseline before claiming the 30–60% hypothesis.

Product projection may ship for analysis/Shadow after these gates. Preflight and
`SUBMISSION_ELIGIBLE` remain held until authoritative owner receipts and parity suites
exist.

## Executed local fixture checks

The focused Python suite covers the contracts, adapters, registry, reducer, scenarios,
storage graph, benchmark guard, and the 10,000-case fixed-seed property. The focused
TypeScript suite checks registry metadata, the exact Test Center state route, safe UI
copy, and the generic proxy boundary. The disposable repository harness and 50-write
benchmark are local database checks only. No provider, signer, wallet, venue, network,
deployment, or onchain action is part of this validation.

## Kill criteria

- Dispatch or signing accepts the projection as authorization.
- Exposure, policy, approval, quorum, venue, or reconciliation logic is reimplemented
  in the reducer.
- Missing/stale input yields a higher state.
- A single boolean hides blockers or selected Autopilot is shown as effective authority.
- An LLM writes the authority explanation.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
