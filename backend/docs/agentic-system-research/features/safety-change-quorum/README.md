# Safety-Critical Change Quorum and Break-Glass Lease

## Decision

**Approved for design — 86/100; production enforcement is staffing-gated.**

Score: fit 12, evidence 9, safety 14, execution boundary 14, benefit 9,
evaluation 9, data 5, cost 8, latency 6.

## Problem and causal argument

One authenticated principal can currently relax some development safeguards. For a
future production system, exact-hash approval by two genuinely independent qualified
humans removes the enumerated single-principal activation path. A narrow expiring
incident lease enables recovery without silently creating permanent authority.

## Why implement it

- Separates proposal, approval and application of safety-relaxing system changes.
- Makes stale, mixed, replayed or self-approved changes fail closed.
- Keeps shutdown, pause, revoke and lower-cap actions immediately available.
- Constrains break-glass to incident-bound containment/recovery with full receipts.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Enumerated relaxing changes with fresh independent quorum | 100% | High |
| Same human satisfying two approval roles | Zero | High if identity proof is real |
| Break-glass actions increasing execution authority | Zero | High fixture target |
| Total incident reduction | No credible percentage yet | Low/unknown |

If two independent qualified humans do not exist, relaxing production changes remain
blocked; independence must never be simulated with two accounts.

## Boundaries

This governs operator/system configuration, not customer trades, customer policy
consent, wallet ownership or model quorum. Particle/Magic remain owner signers; Safe
is an analogy only and is not introduced. Models and service accounts cannot approve.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Local implementation boundary

Feature 16 now has an isolated checked-in-fixture Test Center replay only. Synthetic
qualification is untrusted and Feature 17 authoritative qualification remains
`UNKNOWN`; product enforcement, staffing claims, owner changes, Temporal automation,
and any signer or external action remain unavailable.

An independent implementation audit is archived privately for the later roadmap
remediation goal. Its existence does not change these product restrictions.

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
