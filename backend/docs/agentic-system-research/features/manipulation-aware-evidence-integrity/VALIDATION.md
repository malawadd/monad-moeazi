# Validation — Manipulation-Aware Evidence Integrity

## Corpus

Freeze labeled benign, malicious, compromised, syndicated, corrected, and disputed
cases including:

- SEC-style official social-account compromise;
- poisoned primary mirror and conflicting official primaries;
- copied wire story swarm and adversarial paraphrases;
- valid C2PA manifest attached to a false assertion;
- unsigned but accurate primary evidence;
- replayed old headline with fresh retrieval time;
- direct/indirect injection, encoded/obfuscated instructions, hidden markup;
- wrong market/entity, corrected, revoked, and tombstoned evidence.

Human labels distinguish detection, independence, claim support, and correct policy
outcome. Keep a held-out adversarial set.

## Metrics

- attack/injection detection recall and precision;
- quarantine/degrade/block precision and false-positive burden;
- maximum authority reached by missed attacks;
- exact/near-duplicate cluster precision/recall and independence inflation;
- primary-source and lineage completeness;
- correction/revocation propagation time and dependent-object coverage;
- latency, storage, ingest cost, and source availability impact.

## Promotion thresholds

- 100% of action-eligible material claims carry event, lineage, cluster, registry, and
  policy references;
- 100% of critical claim classes satisfy frozen primary/corroboration requirements or
  remain action-ineligible;
- zero known syndication clusters count more than once in the deterministic suite;
- zero quarantined evidence reaches model prompts or tools outside explicit adversarial
  evaluation;
- zero registry revocations/corrections leave an unexpired dependent proposal without
  recheck/expiry state;
- held-out detection and clustering thresholds are pre-registered by attack class;
  the researched 80–95% range is only a hypothesis.

No aggregate score may hide high authority reached by a missed critical attack.

## Property and failure tests

- Adding reposts cannot increase independent-source count.
- Adding an integrity failure cannot raise confidence or eligibility.
- A valid signature cannot override missing corroboration/claim contradiction.
- Unknown/missing integrity state fails closed for critical action eligibility.
- Redis loss cannot remove durable lineage or correction work.
- Cross-tenant evidence and source-registry changes are rejected/audited.

## Kill criteria

- Marketing/verified badges/signatures are treated as truth.
- LLM judges source authenticity or overrides a gate.
- A second source registry or integrity gate diverges from the evidence fabric.
- Injection content can expose tools, policies, credentials, or execution actions.
- Independence is counted by URL/article quantity.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
