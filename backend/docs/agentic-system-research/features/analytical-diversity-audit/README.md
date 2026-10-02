# Analytical Diversity and Correlated-Error Audit

## Decision

**Approved as an Evaluation-only audit dossier — 84/100.** Any production
`DiversityPolicy` remains held until mature path-level outcomes satisfy the stated
sample, confidence, drift, safety, cost, and latency gates.

## Local fixture status

Feature 38 now has a checked-in deterministic Test Center fixture. It remains a
synthetic, non-authorizing audit: default off, product unavailable, and no provider,
network, workflow, wallet, signer, venue, credit, or execution capability.

Score: fit 13, evidence 7, safety 14, execution boundary 14, benefit 8,
evaluation 9, data 3, cost 8, latency 8.

## Target user and problem

Operators need to know whether apparently different specialist paths fail together.
Unimoazi enforces canonical model-family quorum within a run, but a provider name,
role prompt, or extra vote does not prove independent errors. The current system has no
longitudinal path-level residual, double-fault, or wrong-consensus scorecard.

## Why implement it

- Detects common-mode analytical failure that ordinary within-run disagreement misses.
- Separates model/route/prompt lineage from evidence-source overlap.
- Tests whether family quorum provides effective redundancy without relaxing it.
- Creates an audit input for promotion and incident review, not another voting or
  configuration authority.

## Why the mechanism should work

Ensemble research shows that dependence among component errors affects aggregate
performance and that diversity must be traded against bias and variance, not
maximized. Frozen point-in-time specialist forecasts can be settled later and compared
by predeclared cohort. This supports an error-dependence audit, but supervised-learning
research does not prove that heterogeneous LLM paths are independent or improve crypto
trading.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Scorable path observations with exact lineage | 100%, otherwise unscorable | High |
| Seeded deterministic duplicate/common-wrong fixture detection | 100% | High |
| Noisy dependence fixture recall / false-positive rate | >=90% / <=5% | Medium |
| Held-out high-confidence wrong-consensus reduction after a later policy | 15–30% relative | Low |

The final percentage is a hypothesis. It must report absolute denominators,
abstention, opportunity cost, extra calls, spend, and latency. No PnL claim is made.

## Dependencies and authority boundary

The audit consumes Claim Ledger IDs, evidence integrity clusters, honest citation
identity, path outcomes, and promotion trial lineage. These are dossiers rather than
complete production data, so capture begins before inference.

Canonical family quorum remains a hard minimum. The audit cannot choose a model,
winner, route, threshold, policy, or execution action. A future policy may only reduce
eligibility/confidence, invoke an already-bounded escalation with reserved maximum
spend, or abstain. Missing evidence causes no production policy action.

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
