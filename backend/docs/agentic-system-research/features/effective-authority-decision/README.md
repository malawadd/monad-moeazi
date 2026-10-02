# Effective Authority Decision Projection

## Local fixture implementation status

The Feature 19 increment is implemented only as a default-off isolated Test Center
fixture. It is non-authorizing, uses no product projection or runtime owner, and
always reports product unavailable with authority effect none. Local results cannot
be `SUBMISSION_ELIGIBLE`.

The implemented corpus has 26 checked-in scenarios. It exercises missing, stale,
failed, unknown, wrong-scope, wrong-source-version, and distinct owner-chain
fork/gap/rollback inputs. This is local reduction evidence only; it neither consumes
an authoritative owner receipt nor changes customer authority.

## Decision

**Approved design — 93/100. `SUBMISSION_ELIGIBLE` is gated on authoritative owner
receipts.**

Unimoazi already defines effective authority as the minimum of deployment, customer
mode, policy, credits, evidence/quorum, venue health, reconciliation, and credentials.
This feature makes that result customer-readable and machine-auditable without becoming
a second policy engine or capability token.

## Target user and problem

Customers and operators need to understand why an agent analyzed, simulated, waited
for approval, stopped at preflight, or could not submit. A selected Autopilot mode,
connected wallet, quote, or simulation does not by itself establish effective authority.

## Why implement it

- Projects one consistent status from the canonical checks that actually ran.
- Shows every blocker and safe remediation instead of a fabricated single reason.
- Binds explanations to exact policy/configuration/quote/receipt revisions.
- Reduces ambiguous “why did it not trade?” debugging while respecting no-CoT rules.
- Detects missing/stale/conflicting gate coverage through fail-closed reduction.

## Why the mechanism should work

Each gate owner emits a typed result. A pure reducer computes the most restrictive
capability and lifecycle state. The executor independently reruns the actual checks;
therefore a stale explanation cannot grant authority.

## Proposed benefit

| Hypothesis or invariant | Target | Confidence |
| --- | --- | --- |
| Complete fresh gate projection at covered boundaries | 100% or explicit blocked/unknown state | High |
| Projection exceeding actual enforcement authority | Zero | High |
| Ambiguous support/debug loops | Test 30–60% reduction after baseline | Medium-low |
| Hidden reasoning/secrets in projection | Zero | High |

No PnL, compliance, or safety-certification benefit is claimed.

## Dependencies and boundaries

- Consume, never recompute, canonical gate and receipt outputs.
- [Authoritative risk/reconciliation receipts](../authoritative-risk-snapshot-and-reconciliation/README.md)
  are mandatory before `SUBMISSION_ELIGIBLE` can exist.
- The projection is explicitly non-authorizing and is never accepted by dispatch,
  signing, or venue code as proof.
- Manual Guard/Lite Mode remain distinct from Shadow/Approval/Autopilot.

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
