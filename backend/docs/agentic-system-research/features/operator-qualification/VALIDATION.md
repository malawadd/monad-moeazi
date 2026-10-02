# Validation and Promotion

Test self-review, two identities/one person, expiry, role/policy/environment/rubric/
scenario drift, copied attempt, missing review, revoke/offboarding race, consume-after-
expiry, concurrent reviews, identity substitution, accessible equivalent scenarios,
and attempts to reach production URLs/tools/providers.

Run synthetic stop, uncertain-submission, incident communication, revocation, handoff,
alert storm and unsafe-pressure scenarios. Blind double-review a fixed pack before
qualification gates roles.

## Thresholds

- 100% critical/quorum role uses reference fresh compatible qualification.
- Zero self-reviewed, same-person-independent or expired receipt accepted.
- Zero drill operation reaches production or a paid provider.
- Identical artifacts/rubric reproduce machine-oracle results.
- Every pass has independent review and immutable attempt evidence.
- Offboarding/revocation invalidates later consumption.
- Inter-rater agreement target Cohen's kappa at least 0.70 before enforcement.

Measure repeated-drill missed steps and correct-decision time only as low-confidence
human-performance hypotheses.

Kill or hold for no independent staffing, self-review, poor reviewer calibration,
title/quiz-only or permanent qualification, LLM judge, production injection, signer/
credential/customer data, qualification as authority, retroactive rubric changes or
billable training without approval.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.

## Local fixture result language

The isolated Test Center reports only `fixtureQualificationStatus`. Every result keeps
`productQualificationStatus: unknown`, `productOutcome: unavailable`, and
`authorityEffect: none`; a passing fixture is not a promotion signal.
