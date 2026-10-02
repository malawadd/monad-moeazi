# Future Design

## Contracts

`OperatorRoleVersion`, `TrainingModuleVersion`, `DrillScenarioVersion`, `DrillAttempt`,
`DrillEvaluationRubric`, `IndependentReviewAttestation`,
`OperatorQualificationDecision`, `OperatorQualificationGrant`,
`QualificationRevocation` and `QualificationConsumptionReceipt` bind real workforce
principal, role/scope/environment, artifact/rubric versions, reviewer, issue/expiry and
policy hash. Qualification is a prerequisite receipt, never bearer authority.

## Ownership

Workforce identity authenticates humans; version control owns synthetic scenarios and
rubrics; Timescale immutable attempts/reviews/qualifications; Convex minimal current
projection; Temporal expiry/retraining; Safety Quorum/Incident Communication/
Termination consume fresh receipts. Assurance Corpus supplies machine scenarios/oracles
but cannot qualify people. Evidence Lifecycle governs personnel data. Redis is not
authority.

## Rules

No self-review, same-person aliases, LLM grading/qualification or permanent badges.
Qualification is exact and expires on time, offboarding, role/environment/policy/
rubric/material scenario drift or failed drill. Old attempts cannot pass a new rubric.
Drills use fake clocks/providers/venues/signers only—no customer data, production URLs,
credentials, wallets or paid services. Emergency shutdown remains available under its
monotonic policy even if qualification is missing.

## Cost/rollout

Design/local tabletop scenarios first; activation waits for staffing and reviewer
calibration. Engineering plus recurring human time is material. Any LMS/identity/
training vendor may be billable and requires approval. Rollback disables qualification
consumption but preserves evidence; it cannot fake readiness.

Failure modes include expired curricula, reviewer disagreement, insufficient staffing
and drill-environment leakage; each prevents qualification or production drill use.

## Implemented local fixture boundary

The local ledger uses closed role/module/scenario/rubric versions, strict canonical
hashes, exact rational calibration evidence, and append-only Timescale receipts. The
Test Center accepts only checked-in scenario IDs. It has no Convex projection, Temporal
workflow, workforce/LMS integration, provider, network, signer, wallet, venue, or
product consumer. Consumption is local only and always has `acceptedForProduct: false`.
