# Design — System Safety Assurance Corpus

## Source of truth and contracts

The strict JSON/YAML corpus and canonical hashes live in version control. Each file is
reviewable and bounded.

- `SafetyClaim`: stable ID, owner, statement, criticality, scope, dependencies/version.
- `Invariant`: executable oracle reference, inputs, expected result, applicability.
- `ScenarioPack`/`ScenarioCase`: version, seed, fake clock, fixtures, steps, bounds.
- `FaultMutation`: typed target/path, before/after semantics, expected detecting oracle.
- `EvidenceArtifact`: run/corpus/code hashes, result, logs/receipts, expiry.
- `CoverageMatrix`: claim/invariant/case/mutation/artifact relationships and gaps.
- `AssuranceVerdict`: `supported | unsupported | incomplete | stale`, never `safe` or
  `certified`.

## Scenario domains

- evidence poisoning, correction, staleness, gaps, ordering and wrong-market data;
- schema/model failure, confidence inflation, disagreement and common-mode output;
- credit/budget exhaustion, retry, duplicate/suppressed outbox and schedule drift;
- mode/authority/policy, approval expiry/replay/material change, and emergency stop;
- route/preflight/hash drift, timeout before/after ambiguous broadcast, reconciliation;
- tenant, secret, signer, credential, cache and source-of-truth boundaries.

Cross-feature state machines are mandatory, not only component unit cases.

## Semantic mutation model

Curated mutations change tenant, source/freshness revision, policy/credits/quorum,
expiry/nonce, outbox delivery, strict output, route/preflight hashes, or ambiguous
submission state. Run in isolated ephemeral fixtures, temp worktrees, or containers
with fixed seeds and fake time/providers/venues/signers. Never mutate the real source
tree, external system, wallet, or customer data.

Equivalent/inapplicable mutants require named reviewer, reason, and artifact. Surviving
non-equivalent mutants remain visible and make the claim incomplete.

## Ownership and execution

- Version control owns corpus specs and current expected mappings.
- Existing tests/product logic are independent oracles; models never judge results.
- Timescale stores run, verdict, evidence, mutation and history details.
- Convex receives no corpus projection in this local slice.
- Temporal does not orchestrate corpus packs in this local slice.

Preview/cap scenario count, mutant count, CPU, memory, storage, and runtime. Shards are
deterministic. No automatic billable cloud CI; local/manual runs are the default.

## Rollout and rollback

Start with non-negotiable cross-tenant, secret, authority, idempotency and uncertain
submission claims. Add dossier mappings when their implementations begin. Rollback
stops new corpus runs while preserving failures/evidence; it cannot mark stale evidence
supported or weaken runtime checks.
