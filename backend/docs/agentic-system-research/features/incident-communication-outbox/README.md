# Safety-Incident Communication and Acknowledgement Outbox

## Decision

**Approved, in-app first — 91/100.**

Score: fit 14, evidence 10, safety 14, boundary 13, benefit 9, evaluation 10,
data 8, cost 7, latency 6.

## Causal argument

Incident detection cannot ensure the right person sees the current safe revision.
Atomically creating a durable communication intent with the incident revision, then
tracking delivery, acknowledgement and escalation separately, makes awareness gaps
observable without altering incident or execution authority.

## Why implement it

- Deterministic audience/template/redaction policy and immutable corrections.
- Idempotent in-app delivery, retries, dead letters, acknowledgement and escalation.
- Clear distinction among provider acceptance, display, human acknowledgement and
  incident resolution.
- Customer-safe messages with no cross-tenant/internal-secret leakage.

## Benefit

Targets are 100% material revision/outbox coverage, zero acknowledgement-driven safety
changes, zero cross-tenant disclosures and explicit terminal failures. Awareness-time
improvement is measured from replay/drills; no loss-prevention, regulatory-notice or
recovery-time claim is made.

## Boundary

Dependency Safety owns incident state/severity/recovery. Communication cannot open,
close, downgrade, suppress or resolve it. Start with unmetered in-app delivery; email,
SMS or push requires separate privacy/cost approval.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Local implementation status

Implemented as a default-off, isolated Test Center fixture/replay proof only. Product
Convex/Temporal integration and every external communication channel remain unavailable.

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
