# Non-Owner Operational Secret Custody, Recovery, and Rotation

## Decision

**Approved — 91/100; production/cloud-gated.**

Local implementation status (2026-08-10): **Implemented / Local only / product
unavailable.** Checked-in fake-vault fixtures and isolated Test Center observe/enforce
are available only after the three-prerequisite lease closure. No production vault,
real migration, workflow registration, provider mutation, owner signing or activation
is included.

Independent audit status: **Reviewed — findings deferred** (P0 0 / P1 6 / P2 2 /
P3 0). Detailed evidence is local-only under trace
`deferred-audit-04-operational-secret-custody-v1`, package hash
`74ce8a28e931cdd313774c80a6c45cc9d69567d1a53a90add026085c380bbd2b`.
Those findings are inputs to the later roadmap audit goal and do not authorize product
activation.

Score: fit 14, evidence 11, safety 14, boundary 13, benefit 10, evaluation 9,
data 7, cost 6, latency 7.

## Causal argument and usefulness

Class-specific `reenter | reissue | rewrap | restore_access | replace | forbidden`
semantics make recovery/rotation predictable without adding copies or authority.
Particle/Magic owner keys, seeds, reusable owner signatures and fallback keys are
categorically forbidden.

## Projected benefit

Targets: zero owner material admission or plaintext outside vault; 100% unwraps have
fresh decision/receipt; every class has tested recovery/reissue outcome; no local
revoke is called externally verified. Measure inventory, rotation/recovery and unknown
revocation—not zero compromise or guaranteed memory erase.

Local fake-vault design may proceed. Production requires explicit billable KMS/HSM
approval, hierarchy/policy/recovery evidence, migration acceptance, independent roles
and verified owner-material exclusion. The measurable benefit is the invariant set;
incident-frequency reduction is unknown and not claimed.

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
