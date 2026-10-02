# Operator Qualification and Drill-Readiness Ledger

## Decision

**Approved design — 89/100; enforcement is staffing-gated.**

Score: fit 13, evidence 11, safety 14, boundary 12, benefit 9, evaluation 10,
data 7, cost 7, latency 6.

## Causal argument

Safety Change Quorum requires qualified independent humans, but no owner currently
issues or expires that qualification. Versioned role training, synthetic drills,
objective oracles and independent human review produce an auditable current prerequisite
receipt. Passing does not itself grant authority or guarantee preparedness.

## Why implement it

- Exact role/environment/version scope and expiration.
- Synthetic practical exercises rather than title/video/quiz completion alone.
- Independent review, revocation and consumption receipts.
- Shared prerequisite for critical changes, communication and termination roles.

## Benefit

Targets: 100% critical-role uses bind fresh compatible qualification; zero self-
reviewed/expired acceptance; zero drill contact with production/paid providers. Measure
coverage, expiry gaps and repeated drill errors/timing. No incident/loss-reduction
claim is made.

## Staffing gate

Enforcement waits for real workforce identities, at least two genuinely independent
qualified humans where quorum needs them, and an independent reviewer. Fake accounts
or one person in multiple roles never satisfy the gate.

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

## Local fixture status

Feature 17 now provides an isolated Test Center ledger for checked-in synthetic drills
and synthetic identities only. Product qualification remains `unknown`, product outcome
remains `unavailable`, and authority effect remains `none`. The staffing gate is
unchanged; this is neither a competence nor an incident-readiness claim.

An independent implementation audit is archived privately for the later roadmap
remediation goal. Its existence does not alter the staffing or product-activation gate.
