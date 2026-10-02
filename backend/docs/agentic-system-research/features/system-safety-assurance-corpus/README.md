# System Safety Assurance Corpus

## Decision

**Approved as a local release-qualification and evidence-governance dossier — 93/100.**
It is not a safety certification or runtime authority.

Score: fit 14, evidence 9, safety 14, execution boundary 14, benefit 10,
evaluation 10, data 8, cost 6, latency 8.

## Local implementation status

Feature 27 is implemented only as a default-off synthetic Test Center corpus. It
does not certify the system or affect product/runtime authority. Its implementation
audit is archived privately, remediation is deferred, and product activation remains
unavailable pending the independent ownership and evidence gates below.

## Target user and problem

Engineers and reviewers need to know which system-level safety claims have current,
reproducible evidence. Evaluation Lab has a small evidence/model-output adversarial set,
and every feature dossier has its own validation plan, but there is no versioned
cross-feature claim → invariant → scenario → oracle → artifact registry.

## Why implement it

- Detects integration failures that isolated feature tests miss.
- Makes missing, stale, surviving, or unmapped safety evidence visible.
- Reuses existing deterministic tests and feature validations under one bounded corpus.
- Qualifies later implementations locally without providers, wallets, venues, or
  production fault injection.

## Why the mechanism should work

TEVV and assurance-case practice support explicit lifecycle tests and claim/evidence
arguments. Declarative policy testing shows deterministic decisions can have executable
positive/negative cases. Typed semantic mutations verify that an oracle notices an
important changed condition. None of these mechanisms proves the system safe or
establishes the proposed mutation threshold.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Critical claims mapped to owner, oracle, positive case, relevant mutations and current artifact | 100% | High |
| Critical non-equivalent semantic mutants killed | 100% | High as release gate |
| Overall targeted semantic mutation kill rate | >=85% | Medium as engineering threshold |
| Previously killed critical-mutant regression | Zero | High |
| Integration-defect reduction | Unknown | Not claimable yet |

Coverage is evidence completeness, not correctness. A high score cannot override one
surviving critical mutation or a failed invariant.

## Boundaries

Git/version control owns the corpus definition. Existing product code/tests remain the
oracles and business-rule owners. Models never grade safety. Runs use isolated
fixtures, fake clocks/providers/venues/signers, deterministic seeds, and no network.
The corpus never changes policy, configuration, promotion, authority, or execution.

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
