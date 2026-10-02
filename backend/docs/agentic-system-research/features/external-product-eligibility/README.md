# External Product-Eligibility Rulepack and Decision Receipt

## Decision

**Approved design-only — 84/100; activation is legally and data-source gated.**

Local fixture implementation is available only in the isolated Test Center, default
off. It is not legal advice, product eligibility, KYC/sanctions clearance, product
enforcement, or execution authority.

## Local implementation status

The local fixture has a closed 90-case corpus, typed exact operation and venue
bindings, immutable decision receipts, append-only Timescale migration 034, and an
explicit Feature 21 `requires_revalidation` prerequisite. Local evaluator benchmark
coverage uses 10,000 deterministic cases. The result remains an isolated simulation:
it cannot perform an operation or make a product/runtime decision.

Score: fit 12, evidence 10, safety 13, boundary 11, benefit 8, evaluation 9,
data 5, cost 8, latency 8.

## Causal argument

Externally applicable product rules can be conditional on jurisdiction, customer
class, product, venue, operation and time. A qualified-human-authored, immutable
rulepack plus typed assertions produces consistent reproducible decisions. Software
cannot decide which law applies or turn public guidance into authoritative rules.

## Why implement it

- Separates customer mandate from externally governed product eligibility.
- Binds every decision to exact assertions, product version, rulepack and sources.
- Fails missing/stale/conflicting/ambiguous inputs to unknown/manual review.
- Makes loosening reviewable through Safety Change Quorum.

## Benefit

Measure deterministic golden-case parity, rule coverage, unknown/manual-review rate and
inconsistent-decision rate. Magnitude is unknown. No legal compliance, suitability,
KYC/sanctions clearance, tax advice or enforcement-risk reduction is claimed.

## Activation gates

Qualified counsel must own applicability and rule content; every assertion needs a
lawful reliable source/retention basis; exact scope and effective interval are declared;
golden cases are reviewed. Without these, the feature remains unavailable—not
implicitly eligible. Vendor/counsel/data costs are unknown and require approval.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
