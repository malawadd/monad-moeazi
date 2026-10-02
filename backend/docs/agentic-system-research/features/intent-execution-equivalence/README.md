# Intent–Execution Equivalence Receipt

## Current implementation status

Implemented as an isolated local/Test Center fixture proof only. Product signing,
dispatch, RPC/provider access, venue access, deployment, and live execution remain
unavailable. Feature 10 is frozen `requires_revalidation` context, never authority.

## Decision

**Approved as an independent pre-signing hard gate — 96/100.**

Score: fit 14, evidence 11, safety 14, execution boundary 14, benefit 11,
evaluation 10, data 8, cost 7, latency 7.

## Problem and target user

Customers and operators need proof that the exact transaction or typed-message bytes
presented for Particle/Magic signing preserve the already approved proposal, route,
risk and consent envelope. An allowlisted target and nonempty calldata cannot prove
recipient, token, amount, deadline, minimum output, nested command or state effect.

## Why implement it

- Recursively decodes the exact bytes, including router subplans and Permit2 actions.
- Compares every semantic field and conservative bound with frozen approved inputs.
- Simulates against an explicit block/context and checks expected postconditions.
- Rechecks exact artifact-hash parity at signing and dispatch.

## Why it should work

Known ABIs, router command formats and typed-data schemas permit deterministic
decoding. Pinned simulation can expose many unintended state changes. Exact hashes
then bind the reviewed artifact to the signing request. Decoder coverage and
simulation are not proof of semantic correctness, future execution or loss prevention.

## Benefit, confidence and assumptions

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Submitted artifacts with fresh passing receipt | 100% | High |
| Signing-request/receipt/dispatch byte or hash mismatch | Zero | High |
| Seeded semantic mutation detection | 100% required corpus | High |
| Prepared-intent mismatch defects | 80–99% reduction | Medium |

The percentage is a mutation-corpus hypothesis after a measured baseline, not a
production or PnL claim. Initial benefit is mutation coverage and prevented mismatched
dispatches.

## Boundaries

This receipt answers only whether exact bytes preserve approved intent. It is not a
new intent compiler, proposal, route, policy, simulation authority or reusable
authorization. The deterministic sidecar/gateway owns it; models never decode,
approve, sign or dispatch.

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
