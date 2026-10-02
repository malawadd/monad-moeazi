# External Usage-Rights Rulepack and Operation Decision

## Decision

**Approved design — 86/100; legal/commercial activation-gated.**

Score: fit 14, evidence 10, safety 13, boundary 14, benefit 9, evaluation 9,
data 4, cost 7, latency 6.

## Causal argument and usefulness

A qualified-human-authored rulepack decides whether an exact source/API/dataset/model/
artifact may be fetched, cached, stored, prompted, shared, replayed, evaluated, trained,
displayed, published, redistributed or exported. This supplies the permission decision
consumed by Evidence Fabric/Lifecycle; it is not another store or legal interpreter.

## Projected benefit

Targets: 100% governed operations have exact valid decision or block; zero missing/
mismatched allows, LLM legal decisions or unfulfilled mandatory release obligations;
complete lineage for mixed artifacts. Measure repeated review time only—no non-
infringement, compliance or liability claim.

The reduction in repeated review time is unquantified and low-confidence until a
qualified owner supplies representative rulepacks. Licensed data and counsel can be
billable and require separate approval.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Implemented local-fixture slice

Feature 21 now provides an isolated Test Center slice for checked-in synthetic
rulepacks and exact operation decisions. It is local-only, defaults off, records
append-only fixture history, and simulates a block or fixture permit without performing
the requested operation. It does not establish legal permission, compliance, or
product/runtime authorization.

The verified fixture corpus contains 36 happy and adversarial scenarios across the
12 named operations, plus 144 exact cross-operation non-reuse checks. Product
enforcement, qualified ownership, authoritative source currency, legal review, Convex
status, Temporal obligation work, Redis caching, and downstream consumers remain
unavailable.

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
