# Mandate-to-Policy Semantic Fidelity and Change Consent

## Decision

**Approved with a typed-mandate reframe — 92/100.** Do not claim natural-language
intent preservation.

Score: fit 14, evidence 9, safety 14, execution boundary 14, benefit 10,
evaluation 10, data 7, cost 7, latency 7.

## Target user and problem

Customers need an activated automation policy to match the exact typed constraints
they approved. The current free-text draft path uses deterministic regex parsing,
silently leaves unmatched prose at defaults, and activates parsed JSON without a
mandate hash, per-clause map, compiler version, semantic diff class, tests, or exact
change-consent receipt. Direct form editing does not share such a compiler either.

## Why implement it

- Prevents unsupported, ambiguous, contradictory, or silently defaulted clauses from
  becoming active policy.
- Makes every tightening, loosening, mixed, and unknown field change explicit.
- Gives text-assisted and direct UI editing one deterministic activation path.
- Keeps models non-authoritative while preserving useful drafting assistance.

## Why the mechanism should work

Schema-aware policy systems demonstrate that validation can reject incompatible types,
entities, and actions, and deterministic policy tests can exercise expected decisions.
A canonical typed mandate, compiler, semantic diff, and exact-hash confirmation can
therefore prevent silent activation gaps. Cedar explicitly cannot know whether a
well-formed policy is what its author meant; neither can Unimoazi claim that for prose.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Active policy has current validated mandate mapping and activation receipt | 100% | High |
| Clause mapped or unresolved-and-blocked | 100% | High |
| Loosening/unknown change freshly confirmed against exact hashes | 100% | High |
| Model-created policy activation | Zero | High |
| Natural-language intent/error reduction | Not claimed without labeled/user evidence | — |

## Authority and consent boundary

The typed user-approved `MandateSpec` is authority. Optional model output is clause
projection assistance only and cannot compile, classify, default, confirm, write, or
activate policy. Policy activation is a long-lived authenticated configuration change,
not a per-trade Approval packet. No wallet signature is required unless a separately
approved general consent policy requires it.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Local fixture implementation status

The typed compiler and consent chain are available only through the isolated Test
Center. Product policy remains unavailable; the legacy product path was not migrated.
An independent audit is archived privately and does not change that product gate.

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
