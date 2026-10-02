# Cycle 06 — Dependency Safety, System Assurance, and Policy Fidelity

## Research question

Which cross-layer controls are missing between runtime health, release evidence, and
customer policy activation, and which existing owners must they preserve?

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| Cross-Layer Dependency Safety Envelope | Approved, priority 1 | 94 | Scoped health blocks operations but never authorizes them; reconciliation remains available during submit outages |
| System Safety Assurance Corpus | Approved, priority 2 | 93 | Compose existing tests/validations under versioned claim evidence; never claim safe/certified |
| Mandate-to-Policy Semantic Fidelity and Change Consent | Approved with typed-mandate reframe | 92 | Typed mandate is authority; prose/model projection is optional and non-authoritative |

## Repository gaps confirmed

- A Boolean `system_healthy`, independent endpoints, optimistic workflow inputs, and
  runbook rules do not provide a scoped dependency-by-operation decision or durable
  recovery protocol.
- Evaluation Lab has a narrow adversarial set and feature dossiers have separate test
  plans, but no cross-feature claim/invariant/scenario/oracle/artifact registry.
- Free-text policy parsing can retain defaults for unmatched text; activation lacks a
  mandate/clause/compiler/diff/test/consent receipt shared with direct UI editing.

## Evidence boundaries

- Circuit-breaker/SRE sources support suppression, bounded probes, and degradation
  rationale, not a trading benefit percentage.
- TEVV, assurance cases, and mutation coverage make evidence gaps auditable; they
  cannot prove system safety.
- Cedar, OPA, and strict schema validation support type/back-validation patterns. They
  cannot determine whether a policy preserves a prose author's meaning.

## Corrected claims

- A health receipt can only reduce or preserve allowed work. It is not permission.
- Corpus verdicts are `supported | unsupported | incomplete | stale`; aggregate scores
  never override a critical survivor or gate production.
- Unimoazi guarantees typed-mandate fidelity, deterministic diffing, and exact-hash
  confirmation—not natural-language intent comprehension.

## Stop-condition state

This cycle approved three dossiers, so the consecutive zero-approval count remains
**0**. Research continues.
