# Deterministic Evidence-Delta Triage and Run Planning

## Decision

**Approved in constrained form — 86/100.**

Production phase 1 may make one choice:

`no material change -> durable skip decision`

or

`material/unknown/high-risk -> complete the customer's existing tier plan`.

Adaptive omission of Focus/Pro/Max roles remains Evaluation Lab-only until a new
customer-facing tier contract proves non-inferiority. Lite Mode remains a development
safeguard, not an adaptive tier.

## Target user and problem

Customers and operators need lower cost and faster quiet-market handling without
missing material changes, weakening quorum, dynamically changing models, or making the
worst-case spend unknowable.

## Why implement it

- Avoids provider work when the evidence manifest has no material change.
- Freezes exact slots, routes, dependencies, cost, and escalation ceiling before work.
- Makes skipped, planned, executed, failed, and escalated work auditable.
- Preserves current tier semantics and finish-safe cost reservation.

## Why the mechanism should work

Most savings do not require an LLM router. Deterministic evidence deltas, freshness,
materiality, position risk, policy blocks, and budget state can identify safe no-change
cases. All other production cases retain the current full tier. This captures the
low-risk part of cascade research without importing dynamic model selection.

## Proposed benefit

| Hypothesis or invariant | Target | Confidence |
| --- | --- | --- |
| Median provider spend on comparable quiet/non-material demand | 20–50% reduction | Medium-low |
| p95 handling time for no-change demand | 15–40% reduction, measured as time-to-no-change | Medium |
| Full action-eligible runs preserving tier critical-role/family quorum | 100% | High |
| Run-plan maximum budget exceedance | Zero | High |

Savings never count if missed-event, freshness, calibration, grounding, safety, or
abstention guardrails regress. No PnL benefit is claimed.

## Dependencies

- [Evidence Event Fabric](../evidence-event-fabric/README.md) for deterministic deltas,
  materiality, freshness, and manifests.
- [Specialist source contracts](../specialist-source-value-attribution/README.md) before
  any reduced-slot experiment.
- Existing activated route documents, tier quorum, credits, BYOK reservations, Manual
  Guard, and Lite Mode remain authoritative.

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
