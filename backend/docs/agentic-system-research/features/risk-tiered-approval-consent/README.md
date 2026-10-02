# Risk-Tiered Approval Quality and Consent Receipts

## Decision

**Approved as a bounded consent-lifecycle design — 89/100.** Live Approval remains
gated by authoritative risk, route, authority, signing, and venue certification.

Score: fit 14, evidence 9, safety 13, execution boundary 14, benefit 9,
evaluation 9, data 7, cost 8, latency 6.

## Target user and problem

Approval users need to know exactly what action, risk, cost, uncertainty, and bounds
they accepted. The current mutation verifies ownership, pending status, and proposal
expiry, then changes status. It binds no authoritative risk, route/preflight/quote,
policy revision, cost, uncertainty, packet hash, signer, or one-time consent nonce.

## Why implement it

- Turns an approval click into an immutable, bounded, replay-resistant artifact.
- Detects stale or materially changed proposals before dispatch.
- Uses deterministic risk tiers to focus attention without changing authority or caps.
- Makes every prompt, invalidation, requote, and final preflight auditable.

## Why the mechanism should work

Typed signing can bind the Particle/Magic owner to one structured packet, while
application-owned nonce consumption prevents replay. A signed, user-visible
material-delta envelope allows a fresh quote to proceed only inside reviewed bounds;
unfavorable, route, risk, policy, authority, uncertainty, or expiry changes trigger a
new packet. Usable-security research motivates fewer, clearer warnings, but does not
prove comprehension, legal consent, safer trading, or better returns.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Submission attempt has one current accepted packet, unconsumed nonce, and matching fresh preflight, or is blocked | 100% | High |
| Material post-approval delta invalidation | 100% | High |
| Stale confirmation reduction | 30–60% relative | Medium-low |
| Duplicate approval-prompt reduction | 20–40% relative | Medium-low |

The feature may initially detect more stale packets, and high-risk ceremony may
increase prompts. No comprehension, compliance, PnL, loss, or advice claim is made.

## Dependencies and boundaries

Authoritative risk/reconciliation, sizing, routing, Effective Authority, uncertainty,
and real preflight receipts are prerequisites. Approval is never fresh preflight or
dispatch authority. Shadow never prompts/signs. Autopilot remains a distinct bounded
customer mode. Particle and Magic remain the only owner signers; no reusable blanket
or future-trade consent is allowed.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Local fixture status

Feature 20 has a deterministic local replay implementation in the isolated Test Center.
It persists only synthetic append-only evidence and remains non-authorizing; product
Approval and EIP-712 signing remain unchanged and unavailable.

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
