# Manipulation-Aware Evidence Independence and Integrity

## Decision

**Approved with prerequisites — 92/100. Final-cycle priority 1.**

This is defense-in-depth, not “manipulation resistance” as an absolute claim. It
extends the Evidence Event Fabric with source identity, lineage, independence clusters,
primary-source requirements, injection quarantine, corrections, and deterministic
confidence/eligibility caps.

## Target user and problem

Ten reposts can look like ten sources, an official account can be compromised, signed
media can still make a false claim, and retrieved text can contain adversarial
instructions. Model-family quorum does not provide evidence-source independence.

## Why implement it

- Prevents syndication/reposts from satisfying an independent-source requirement.
- Requires authoritative primary evidence for critical claim classes.
- Treats all external content as data, never instructions or tools.
- Propagates source revocations/corrections to dependent claims and proposals.
- Caps or blocks action eligibility deterministically after model output.

## Why the mechanism should work

Stable source identity, provenance, clustering, primary-source policy, and strict
content isolation make common manipulation paths visible and testable. None proves
truth; together they reduce how much authority unverified or correlated evidence can
reach.

## Proposed benefit

| Hypothesis or invariant | Target | Confidence |
| --- | --- | --- |
| Eligible material claims with lineage and cluster references | 100% after cutover | High |
| Manipulated single-source attacks detected | Test 80–95% recall, reported separately from quarantine/capping | Medium-low |
| Critical claims satisfying primary/corroboration policy | 100% or action-ineligible | High |
| Cross-cluster independence inflation | Zero in deterministic corpus | High |

No realized-loss reduction is claimed. False-positive burden and missed-attack
authority must be reported.

## Prerequisites

- [Evidence Event Fabric](../evidence-event-fabric/README.md).
- Honest supplied/cited/supporting evidence identity from
  [source-value attribution](../specialist-source-value-attribution/README.md).
- Typed claims from the [Claim Disagreement Ledger](../claim-disagreement-ledger/README.md).

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
